use async_trait::async_trait;
use chrono::{Datelike, NaiveDate, TimeZone, Utc};
use futures::StreamExt;
use log::info;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::model::{
    build_idempotency_key, is_auto_dividend_key, is_auto_dividend_source, round_amount_str,
    DividendCalendarEvent, DividendCalendarEventKind, DividendSyncAccountResult,
    DividendSyncResult, SOURCE_SYSTEM,
};
use super::projection::project_future_dividends;
use super::settings::{
    default_tax_for_currency_or_mic, DividendSyncSettings, PSE_MIC, SETTINGS_KEY,
};
use super::shares::{compute_shares_at_ex_date, TradeLikeActivity};
use crate::accounts::{AccountServiceTrait, TrackingMode};
use crate::activities::{
    Activity, ActivityBulkMutationRequest, ActivityServiceTrait, ActivityStatus,
    AssetResolutionInput, NewActivity, ACTIVITY_TYPE_BUY, ACTIVITY_TYPE_DIVIDEND,
    ACTIVITY_TYPE_SELL, ACTIVITY_TYPE_SPLIT, ACTIVITY_TYPE_TRANSFER_IN, ACTIVITY_TYPE_TRANSFER_OUT,
};
use crate::errors::{Error, Result};
use crate::portfolio::holdings::{Holding, HoldingType, HoldingsServiceTrait};
use crate::portfolio::snapshot::SnapshotRepositoryTrait;
use crate::quotes::{FetchDividendsParams, QuoteServiceTrait};
use crate::settings::SettingsServiceTrait;
use wealthfolio_market_data::DividendEvent;

/// Provider history is fetched per distinct symbol; the registry rate limiter
/// still paces the actual outbound calls.
const FETCH_CONCURRENCY: usize = 8;

/// How far ahead cadence-based dividend projections run.
const PROJECTION_HORIZON_DAYS: i64 = 366;

type FetchedDividends = HashMap<String, std::result::Result<Vec<DividendEvent>, String>>;

/// (asset_id, mic, symbol, currency, preferred_provider)
type HoldingSymbolParts = (String, Option<String>, String, String, Option<String>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDividendView {
    pub asset_id: String,
    pub symbol: String,
    pub currency: String,
    pub ytd_income: Decimal,
    pub ttm_income: Decimal,
    pub events: Vec<DividendCalendarEvent>,
}

#[async_trait]
pub trait DividendSyncServiceTrait: Send + Sync {
    fn get_settings(&self) -> Result<DividendSyncSettings>;
    async fn update_settings(&self, settings: DividendSyncSettings)
        -> Result<DividendSyncSettings>;
    async fn sync(&self) -> Result<DividendSyncResult>;
    async fn remove_auto_created(&self) -> Result<usize>;
    async fn build_calendar_events(&self) -> Result<Vec<DividendCalendarEvent>>;
    async fn build_asset_dividend_view(&self, asset_id: &str) -> Result<AssetDividendView>;
}

pub struct DividendSyncService {
    settings: Arc<dyn SettingsServiceTrait>,
    accounts: Arc<dyn AccountServiceTrait>,
    activities: Arc<dyn ActivityServiceTrait>,
    holdings: Arc<dyn HoldingsServiceTrait>,
    quotes: Arc<dyn QuoteServiceTrait>,
    snapshots: Arc<dyn SnapshotRepositoryTrait>,
    base_currency: Arc<std::sync::RwLock<String>>,
}

impl DividendSyncService {
    pub fn new(
        settings: Arc<dyn SettingsServiceTrait>,
        accounts: Arc<dyn AccountServiceTrait>,
        activities: Arc<dyn ActivityServiceTrait>,
        holdings: Arc<dyn HoldingsServiceTrait>,
        quotes: Arc<dyn QuoteServiceTrait>,
        snapshots: Arc<dyn SnapshotRepositoryTrait>,
        base_currency: Arc<std::sync::RwLock<String>>,
    ) -> Self {
        Self {
            settings,
            accounts,
            activities,
            holdings,
            quotes,
            snapshots,
            base_currency,
        }
    }

    fn load_settings(&self) -> Result<DividendSyncSettings> {
        match self.settings.get_setting_value(SETTINGS_KEY)? {
            Some(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
            None => Ok(DividendSyncSettings::default()),
        }
    }

    async fn save_settings(&self, settings: &DividendSyncSettings) -> Result<()> {
        let json = serde_json::to_string(settings)
            .map_err(|e| Error::Unexpected(format!("serialize dividend settings: {e}")))?;
        self.settings.set_setting_value(SETTINGS_KEY, &json).await
    }

    fn preferred_provider(mic: Option<&str>, asset_preferred: Option<&str>) -> Option<String> {
        if let Some(p) = asset_preferred.filter(|s| !s.is_empty()) {
            return Some(p.to_string());
        }
        if mic == Some(PSE_MIC) {
            Some("EODHD".to_string())
        } else {
            None
        }
    }

    /// A symbol without an exchange MIC is resolved as a bare US listing, so a
    /// non-USD instrument would silently receive another company's dividend
    /// history (e.g. PSE `BPI` matching a US ticker).
    fn listing_is_ambiguous(mic: Option<&str>, currency: &str) -> bool {
        mic.is_none_or(str::is_empty) && !currency.eq_ignore_ascii_case("USD")
    }

    fn fetch_key(symbol: &str, mic: Option<&str>, provider: Option<&str>) -> String {
        format!(
            "{}|{}|{}",
            symbol.to_ascii_uppercase(),
            mic.unwrap_or(""),
            provider.unwrap_or("auto")
        )
    }

    fn ex_date_from_unix(secs: i64) -> Option<NaiveDate> {
        Utc.timestamp_opt(secs, 0)
            .single()
            .map(|dt| dt.date_naive())
    }

    async fn fetch_dividends(
        &self,
        symbol: &str,
        mic: Option<&str>,
        quote_ccy: Option<&str>,
        preferred_provider: Option<String>,
    ) -> Result<Vec<DividendEvent>> {
        self.quotes
            .fetch_dividends(FetchDividendsParams {
                symbol: symbol.to_string(),
                exchange_mic: mic.map(str::to_string),
                instrument_type: None,
                quote_ccy: quote_ccy.map(str::to_string),
                preferred_provider,
                start: None,
                end: None,
            })
            .await
    }

    /// Fetch dividend history for every distinct symbol concurrently, keyed by
    /// [`Self::fetch_key`]. Sequential per-symbol fetching blows the request
    /// timeout once an account holds more than a handful of positions.
    async fn prefetch_dividends<'a>(
        &self,
        holdings: impl Iterator<Item = &'a Holding>,
    ) -> FetchedDividends {
        let mut targets: HashMap<String, (String, Option<String>, String, Option<String>)> =
            HashMap::new();
        for holding in holdings {
            let Some((_, mic, symbol, ccy, asset_pref)) = Self::holding_symbol(holding) else {
                continue;
            };
            if Self::listing_is_ambiguous(mic.as_deref(), &ccy) {
                continue;
            }
            let provider = Self::preferred_provider(mic.as_deref(), asset_pref.as_deref());
            let key = Self::fetch_key(&symbol, mic.as_deref(), provider.as_deref());
            targets.entry(key).or_insert((symbol, mic, ccy, provider));
        }

        futures::stream::iter(targets.into_iter().map(
            |(key, (symbol, mic, ccy, provider))| async move {
                let fetched = self
                    .fetch_dividends(&symbol, mic.as_deref(), Some(&ccy), provider)
                    .await
                    .map_err(|e| e.to_string());
                (key, fetched)
            },
        ))
        .buffer_unordered(FETCH_CONCURRENCY)
        .collect()
        .await
    }

    fn holding_symbol(holding: &Holding) -> Option<HoldingSymbolParts> {
        if holding.holding_type != HoldingType::Security {
            return None;
        }
        let instrument = holding.instrument.as_ref()?;
        let asset_id = instrument.id.clone();
        if asset_id.is_empty() || asset_id.to_ascii_uppercase().starts_with("CASH:") {
            return None;
        }
        let raw = instrument.symbol.clone();
        let symbol = raw
            .trim_start_matches("PSE:")
            .split('.')
            .next()
            .unwrap_or(&raw)
            .trim()
            .to_string();
        if symbol.is_empty() {
            return None;
        }
        Some((
            asset_id,
            instrument.exchange_mic.clone(),
            symbol,
            instrument.currency.clone(),
            instrument.preferred_provider.clone(),
        ))
    }

    fn trades_for_asset(&self, account_id: &str, asset_id: &str) -> Result<Vec<TradeLikeActivity>> {
        let activities = self.activities.get_activities_by_account_id(account_id)?;
        let trade_types = [
            ACTIVITY_TYPE_BUY,
            ACTIVITY_TYPE_SELL,
            ACTIVITY_TYPE_SPLIT,
            ACTIVITY_TYPE_TRANSFER_IN,
            ACTIVITY_TYPE_TRANSFER_OUT,
        ];
        Ok(activities
            .into_iter()
            .filter(|a| a.asset_id.as_deref() == Some(asset_id))
            .filter(|a| trade_types.iter().any(|x| *x == a.effective_type()))
            .map(|a| TradeLikeActivity {
                activity_type: a.effective_type().to_string(),
                activity_date: a.activity_date,
                quantity: a.quantity.unwrap_or(Decimal::ZERO),
            })
            .collect())
    }

    fn shares_at_ex_date(
        &self,
        account_id: &str,
        asset_id: &str,
        tracking_mode: TrackingMode,
        trades: &[TradeLikeActivity],
        ex_date: NaiveDate,
    ) -> Decimal {
        if !trades.is_empty() {
            return compute_shares_at_ex_date(trades, ex_date);
        }
        if tracking_mode == TrackingMode::Holdings {
            if let Ok(Some(snap)) = self
                .snapshots
                .get_latest_snapshot_before_date(account_id, ex_date)
            {
                return snap
                    .positions
                    .get(asset_id)
                    .map(|p| p.quantity.abs())
                    .unwrap_or(Decimal::ZERO);
            }
        }
        Decimal::ZERO
    }

    /// Idempotency keys plus `asset_id:yyyy-mm-dd` date guards (covers legacy addon keys).
    fn existing_dividend_guards(
        &self,
        account_id: &str,
    ) -> Result<(HashSet<String>, HashSet<String>)> {
        let mut keys = HashSet::new();
        let mut dated = HashSet::new();
        for a in self.activities.get_activities_by_account_id(account_id)? {
            if a.effective_type() != ACTIVITY_TYPE_DIVIDEND {
                continue;
            }
            let date = Self::activity_date(&a);
            if let Some(k) = a.idempotency_key.clone() {
                keys.insert(k);
            }
            if let Some(asset_id) = a.asset_id.as_deref() {
                dated.insert(format!("{}:{}", asset_id, date.format("%Y-%m-%d")));
            }
        }
        Ok((keys, dated))
    }

    fn legacy_idempotency_key(symbol: &str, ex_unix: i64, rounded: &str) -> String {
        format!(
            "pse-div:{}:{}:{}",
            symbol.to_ascii_uppercase(),
            ex_unix,
            rounded
        )
    }

    fn activity_date(a: &Activity) -> NaiveDate {
        a.activity_date.date_naive()
    }

    fn normalize_symbol(symbol: &str) -> String {
        symbol
            .trim_start_matches("PSE:")
            .split('.')
            .next()
            .unwrap_or(symbol)
            .to_ascii_uppercase()
    }
}

#[async_trait]
impl DividendSyncServiceTrait for DividendSyncService {
    fn get_settings(&self) -> Result<DividendSyncSettings> {
        self.load_settings()
    }

    async fn update_settings(
        &self,
        settings: DividendSyncSettings,
    ) -> Result<DividendSyncSettings> {
        self.save_settings(&settings).await?;
        Ok(settings)
    }

    async fn remove_auto_created(&self) -> Result<usize> {
        let accounts = self.accounts.get_all_accounts()?;
        let mut delete_ids = Vec::new();
        for account in accounts {
            for a in self.activities.get_activities_by_account_id(&account.id)? {
                if a.effective_type() != ACTIVITY_TYPE_DIVIDEND {
                    continue;
                }
                if is_auto_dividend_source(a.source_system.as_deref())
                    || is_auto_dividend_key(a.idempotency_key.as_deref())
                {
                    delete_ids.push(a.id);
                }
            }
        }
        let n = delete_ids.len();
        if n > 0 {
            self.activities
                .bulk_mutate_activities(ActivityBulkMutationRequest {
                    creates: vec![],
                    updates: vec![],
                    delete_ids,
                })
                .await?;
        }
        Ok(n)
    }

    async fn sync(&self) -> Result<DividendSyncResult> {
        let mut settings = self.load_settings()?;
        let mut result = DividendSyncResult::default();
        if !settings.global_enabled {
            result
                .errors
                .push("Dividend sync is disabled. Enable it in Dividend settings.".into());
            return Ok(result);
        }

        let base_ccy = self.base_currency.read().unwrap().clone();
        let accounts = self.accounts.get_all_accounts()?;
        let mut creates: Vec<NewActivity> = Vec::new();
        let mut batch_keys: HashSet<String> = HashSet::new();
        let mut net_cash = Decimal::ZERO;
        let today = Utc::now().date_naive();

        // Resolve holdings for every enabled account first so provider history
        // for all symbols can be fetched concurrently.
        let mut planned = Vec::new();
        for account in accounts {
            let default_tax = default_tax_for_currency_or_mic(&account.currency, None);
            let acct = settings.ensure_account(&account.id, default_tax).clone();
            if !acct.enabled {
                continue;
            }
            match self.holdings.get_holdings(&account.id, &base_ccy).await {
                Ok(holdings) => planned.push((account, acct, holdings)),
                Err(e) => result
                    .errors
                    .push(format!("Holdings failed for {}: {e}", account.name)),
            }
        }

        let fetched = self
            .prefetch_dividends(planned.iter().flat_map(|(_, _, h)| h.iter()))
            .await;

        for (account, acct, holdings) in planned {
            let mut acct_result = DividendSyncAccountResult {
                account_id: account.id.clone(),
                account_name: account.name.clone(),
                ..Default::default()
            };

            let (mut existing_keys, mut existing_dated) =
                self.existing_dividend_guards(&account.id)?;

            for holding in holdings {
                let Some((asset_id, mic, symbol, ccy, asset_pref)) = Self::holding_symbol(&holding)
                else {
                    continue;
                };

                if Self::listing_is_ambiguous(mic.as_deref(), &ccy) {
                    result.errors.push(format!(
                        "Skipped {symbol} ({}): set an exchange for this {ccy} asset so dividends resolve to the right listing",
                        account.name
                    ));
                    continue;
                }

                let provider = Self::preferred_provider(mic.as_deref(), asset_pref.as_deref());
                let fetch_k = Self::fetch_key(&symbol, mic.as_deref(), provider.as_deref());
                let dividends = match fetched.get(&fetch_k) {
                    Some(Ok(events)) => events.clone(),
                    Some(Err(e)) => {
                        result.errors.push(format!(
                            "Dividends failed for {symbol} ({}): {e}",
                            account.name
                        ));
                        continue;
                    }
                    None => continue,
                };
                if dividends.is_empty() {
                    continue;
                }

                let trades = self.trades_for_asset(&account.id, &asset_id)?;
                let tax_rate = Decimal::from_f64_retain(acct.dividend_tax_rate)
                    .unwrap_or(Decimal::ZERO)
                    .clamp(Decimal::ZERO, Decimal::ONE);

                for div in dividends {
                    let Some(ex_date) = Self::ex_date_from_unix(div.date) else {
                        continue;
                    };
                    if ex_date > today {
                        continue;
                    }

                    let rounded = round_amount_str(div.amount, 6);
                    let ex_ymd = ex_date.format("%Y-%m-%d").to_string();
                    let key = build_idempotency_key(&account.id, &asset_id, &ex_ymd, &rounded);
                    let legacy = Self::legacy_idempotency_key(&symbol, div.date, &rounded);
                    let dated = format!("{asset_id}:{ex_ymd}");
                    if existing_keys.contains(&key)
                        || existing_keys.contains(&legacy)
                        || existing_dated.contains(&dated)
                        || batch_keys.contains(&key)
                    {
                        result.skipped += 1;
                        result.skipped_duplicates += 1;
                        acct_result.skipped_duplicates += 1;
                        continue;
                    }

                    let shares = self.shares_at_ex_date(
                        &account.id,
                        &asset_id,
                        account.tracking_mode,
                        &trades,
                        ex_date,
                    );
                    if shares <= Decimal::ZERO {
                        result.skipped += 1;
                        result.skipped_no_shares += 1;
                        acct_result.skipped_no_shares += 1;
                        continue;
                    }

                    let per_share = Decimal::from_f64_retain(div.amount).unwrap_or(Decimal::ZERO);
                    let gross = shares * per_share;
                    let tax = (gross * tax_rate).round_dp(2);
                    let net = gross - tax;
                    net_cash += net;

                    let metadata = serde_json::json!({
                        "auto_generated": true,
                        "provider": provider.clone().unwrap_or_else(|| "auto".into()),
                        "gross_amount": gross.to_string(),
                        "net_amount": net.to_string(),
                        "tax_rate": acct.dividend_tax_rate,
                        "tax_amount": tax.to_string(),
                        "amount_per_share": per_share.to_string(),
                        "ex_date": ex_ymd,
                        "shares_at_ex_date": shares.to_string(),
                        "shares_source": if trades.is_empty() { "snapshot_at_ex_date" } else { "activity_replay" },
                        "activity_date_note": "ex-date (provider payment date unavailable)",
                    });

                    creates.push(NewActivity {
                        id: None,
                        account_id: account.id.clone(),
                        asset: Some(AssetResolutionInput {
                            id: Some(asset_id.clone()),
                            symbol: Some(symbol.clone()),
                            exchange_mic: mic.clone(),
                            kind: None,
                            name: None,
                            quote_mode: None,
                            quote_ccy: Some(ccy.clone()),
                            instrument_type: None,
                            provider_id: provider.clone(),
                            provider_symbol: None,
                        }),
                        activity_type: ACTIVITY_TYPE_DIVIDEND.to_string(),
                        subtype: None,
                        activity_date: ex_ymd,
                        quantity: Some(shares),
                        unit_price: Some(per_share),
                        currency: ccy.clone(),
                        fee: Some(Decimal::ZERO),
                        tax: Some(tax),
                        amount: Some(gross),
                        status: Some(ActivityStatus::Posted),
                        notes: Some("Auto-created from market dividend history".into()),
                        fx_rate: None,
                        metadata: Some(metadata.to_string()),
                        needs_review: Some(false),
                        source_system: Some(SOURCE_SYSTEM.to_string()),
                        source_record_id: Some(format!("{asset_id}:{ex_date}:{rounded}")),
                        source_group_id: None,
                        idempotency_key: Some(key.clone()),
                        import_run_id: None,
                    });
                    existing_keys.insert(key.clone());
                    existing_dated.insert(dated);
                    batch_keys.insert(key);
                    acct_result.created += 1;
                }
            }
            result.accounts.push(acct_result);
        }

        if !creates.is_empty() {
            let save = self
                .activities
                .bulk_mutate_activities(ActivityBulkMutationRequest {
                    creates,
                    updates: vec![],
                    delete_ids: vec![],
                })
                .await?;
            result.created = save.created.len();
            for err in save.errors {
                result.errors.push(err.message);
            }
            info!(
                "Dividend sync created {} activities (net cash ≈ {})",
                result.created, net_cash
            );
        }

        let _ = self.save_settings(&settings).await;
        result.net_cash_added = net_cash.round_dp(2).to_string();
        Ok(result)
    }

    async fn build_calendar_events(&self) -> Result<Vec<DividendCalendarEvent>> {
        let settings = self.load_settings()?;
        let base_ccy = self.base_currency.read().unwrap().clone();
        let accounts = self.accounts.get_all_accounts()?;
        let now = Utc::now().date_naive();
        let mut events = Vec::new();

        let mut planned = Vec::new();
        for account in accounts {
            let acct = settings.account_settings(&account.id);
            let holdings = self
                .holdings
                .get_holdings(&account.id, &base_ccy)
                .await
                .unwrap_or_default();
            planned.push((account, acct, holdings));
        }

        // Provider-derived markers only for accounts opted into sync.
        let fetched = self
            .prefetch_dividends(
                planned
                    .iter()
                    .filter(|(_, acct, _)| settings.global_enabled && acct.enabled)
                    .flat_map(|(_, _, h)| h.iter()),
            )
            .await;

        for (account, acct, holdings) in planned {
            let acts = self.activities.get_activities_by_account_id(&account.id)?;
            let posted: Vec<_> = acts
                .iter()
                .filter(|a| a.effective_type() == ACTIVITY_TYPE_DIVIDEND)
                .collect();

            for a in &posted {
                let date = Self::activity_date(a);
                let symbol = holdings
                    .iter()
                    .find(|h| h.instrument.as_ref().map(|i| i.id.as_str()) == a.asset_id.as_deref())
                    .and_then(|h| h.instrument.as_ref().map(|i| i.symbol.clone()))
                    .unwrap_or_else(|| {
                        a.asset_id
                            .as_deref()
                            .and_then(|id| id.split(':').nth(1).map(str::to_string))
                            .unwrap_or_else(|| "?".into())
                    });

                events.push(DividendCalendarEvent {
                    id: format!("posted-{}", a.id),
                    date: date.format("%Y-%m-%d").to_string(),
                    symbol,
                    account_id: account.id.clone(),
                    account_name: account.name.clone(),
                    display_amount: a.amount.unwrap_or(Decimal::ZERO),
                    currency: a.currency.clone(),
                    kind: DividendCalendarEventKind::Posted,
                    activity_id: Some(a.id.clone()),
                    notes: Some(if is_auto_dividend_source(a.source_system.as_deref()) {
                        "Auto-created".into()
                    } else {
                        "Recorded activity".into()
                    }),
                });
            }

            let posted_keys: HashSet<String> = posted
                .iter()
                .map(|a| {
                    format!(
                        "{}:{}:{}",
                        account.id,
                        a.asset_id.as_deref().unwrap_or(""),
                        Self::activity_date(a).format("%Y-%m-%d")
                    )
                })
                .collect();

            if !settings.global_enabled || !acct.enabled {
                continue;
            }

            for holding in &holdings {
                let Some((asset_id, mic, symbol, ccy, asset_pref)) = Self::holding_symbol(holding)
                else {
                    continue;
                };
                let provider = Self::preferred_provider(mic.as_deref(), asset_pref.as_deref());
                let fetch_k = Self::fetch_key(&symbol, mic.as_deref(), provider.as_deref());
                let dividends = match fetched.get(&fetch_k) {
                    Some(Ok(events)) => events.clone(),
                    _ => continue,
                };
                let trades = self
                    .trades_for_asset(&account.id, &asset_id)
                    .unwrap_or_default();
                let current_qty = holding.quantity;

                for div in &dividends {
                    let Some(ex_date) = Self::ex_date_from_unix(div.date) else {
                        continue;
                    };
                    let date = ex_date.format("%Y-%m-%d").to_string();
                    let posted_key = format!("{}:{}:{}", account.id, asset_id, date);
                    if posted_keys.contains(&posted_key) {
                        continue;
                    }

                    let is_upcoming = ex_date > now;
                    let shares = if is_upcoming {
                        current_qty
                    } else {
                        self.shares_at_ex_date(
                            &account.id,
                            &asset_id,
                            account.tracking_mode,
                            &trades,
                            ex_date,
                        )
                    };
                    // Skip past "missing" and upcoming estimates when shares were/are 0 —
                    // those aren't actionable for this account.
                    if shares <= Decimal::ZERO {
                        continue;
                    }
                    let per_share = Decimal::from_f64_retain(div.amount).unwrap_or(Decimal::ZERO);
                    let est = shares * per_share;

                    events.push(DividendCalendarEvent {
                        id: format!(
                            "{}-{}-{}-{}",
                            if is_upcoming { "upcoming" } else { "past" },
                            account.id,
                            symbol,
                            div.date
                        ),
                        date,
                        symbol: symbol.clone(),
                        account_id: account.id.clone(),
                        account_name: account.name.clone(),
                        display_amount: est,
                        currency: ccy.clone(),
                        kind: if is_upcoming {
                            DividendCalendarEventKind::UpcomingEstimated
                        } else {
                            DividendCalendarEventKind::PastUnposted
                        },
                        activity_id: None,
                        notes: Some(if is_upcoming {
                            "Est. from current holdings".into()
                        } else {
                            "Not synced".into()
                        }),
                    });
                }

                // Providers rarely announce dividends more than a few weeks out, so
                // fall back to the asset's own cadence for the rest of the year.
                if current_qty <= Decimal::ZERO {
                    continue;
                }
                let announced_upcoming = dividends
                    .iter()
                    .filter_map(|div| Self::ex_date_from_unix(div.date))
                    .any(|ex_date| ex_date > now);
                if announced_upcoming {
                    continue;
                }
                let history: Vec<(NaiveDate, Decimal)> = dividends
                    .iter()
                    .filter_map(|div| {
                        Some((
                            Self::ex_date_from_unix(div.date)?,
                            Decimal::from_f64_retain(div.amount)?,
                        ))
                    })
                    .collect();

                for projected in project_future_dividends(
                    &history,
                    now,
                    now + chrono::Duration::days(PROJECTION_HORIZON_DAYS),
                ) {
                    events.push(DividendCalendarEvent {
                        id: format!("projected-{}-{}-{}", account.id, symbol, projected.ex_date),
                        date: projected.ex_date.format("%Y-%m-%d").to_string(),
                        symbol: symbol.clone(),
                        account_id: account.id.clone(),
                        account_name: account.name.clone(),
                        display_amount: current_qty * projected.per_share,
                        currency: ccy.clone(),
                        kind: DividendCalendarEventKind::UpcomingEstimated,
                        activity_id: None,
                        notes: Some("Projected from past cadence".into()),
                    });
                }
            }
        }

        events.sort_by(|a, b| {
            a.date
                .cmp(&b.date)
                .then(a.account_name.cmp(&b.account_name))
                .then(a.symbol.cmp(&b.symbol))
        });
        Ok(events)
    }

    async fn build_asset_dividend_view(&self, asset_id: &str) -> Result<AssetDividendView> {
        let base_ccy = self.base_currency.read().unwrap().clone();
        let accounts = self.accounts.get_all_accounts()?;
        let mut symbol = asset_id.to_string();
        // Dividends pay in the instrument's quote currency; base currency is the
        // fallback when the asset is no longer held.
        let mut currency = base_ccy.clone();
        let mut currency_resolved = false;
        for account in &accounts {
            if let Ok(holdings) = self.holdings.get_holdings(&account.id, &base_ccy).await {
                if let Some(h) = holdings
                    .iter()
                    .find(|h| h.instrument.as_ref().map(|i| i.id.as_str()) == Some(asset_id))
                {
                    if let Some(inst) = &h.instrument {
                        symbol = inst.symbol.clone();
                        currency = inst.currency.clone();
                        currency_resolved = true;
                    }
                    break;
                }
            }
        }

        let norm = Self::normalize_symbol(&symbol);
        let filtered: Vec<_> = self
            .build_calendar_events()
            .await?
            .into_iter()
            .filter(|e| Self::normalize_symbol(&e.symbol) == norm)
            .collect();

        if !currency_resolved {
            if let Some(event) = filtered
                .iter()
                .find(|e| e.kind == DividendCalendarEventKind::Posted)
                .or_else(|| filtered.first())
            {
                currency = event.currency.clone();
            }
        }

        let now = Utc::now().date_naive();
        let year_start = NaiveDate::from_ymd_opt(now.year(), 1, 1).unwrap_or(now);
        let ttm_start = now - chrono::Duration::days(365);
        let mut ytd = Decimal::ZERO;
        let mut ttm = Decimal::ZERO;
        for e in &filtered {
            if e.kind != DividendCalendarEventKind::Posted {
                continue;
            }
            if let Ok(d) = NaiveDate::parse_from_str(&e.date, "%Y-%m-%d") {
                if d >= year_start {
                    ytd += e.display_amount;
                }
                if d >= ttm_start {
                    ttm += e.display_amount;
                }
            }
        }

        Ok(AssetDividendView {
            asset_id: asset_id.to_string(),
            symbol,
            currency,
            ytd_income: ytd,
            ttm_income: ttm,
            events: filtered,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Svc = DividendSyncService;

    #[test]
    fn ambiguous_listing_requires_mic_for_non_usd() {
        assert!(Svc::listing_is_ambiguous(None, "PHP"));
        assert!(Svc::listing_is_ambiguous(Some(""), "PHP"));
        assert!(!Svc::listing_is_ambiguous(Some(PSE_MIC), "PHP"));
        assert!(!Svc::listing_is_ambiguous(None, "USD"));
        assert!(!Svc::listing_is_ambiguous(None, "usd"));
    }
}
