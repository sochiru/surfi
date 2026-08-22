use async_trait::async_trait;
use chrono::Utc;
use chrono_tz::Tz;
use log::info;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::accrual::{plan_interest, PlannedActivity, PlannedAmendment, PlannedKind};
use super::cash::CashLedgerEvent;
use super::model::{is_auto_interest_key, is_auto_interest_source, SOURCE_SYSTEM};
use super::settings::{Mp2DividendRates, SETTINGS_KEY};
use crate::accounts::{account_types, AccountServiceTrait};
use crate::activities::{
    ActivityBulkMutationRequest, ActivityServiceTrait, ActivityStatus, ActivityUpdate, NewActivity,
    ACTIVITY_TYPE_INTEREST, ACTIVITY_TYPE_WITHDRAWAL,
};
use crate::errors::Result;
use crate::settings::SettingsServiceTrait;
use crate::utils::time_utils::{activity_date_in_tz, parse_user_timezone_or_default};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashInterestSyncResult {
    pub created: usize,
    /// Rows rewritten because a newly declared rate changed the amount.
    pub amended: usize,
    /// Estimates retracted because a manual entry now covers that date.
    pub removed: usize,
    pub skipped: usize,
    pub skipped_overrides: usize,
    pub skipped_duplicates: usize,
    pub accounts: Vec<CashInterestAccountResult>,
    pub errors: Vec<String>,
    pub net_cash_added: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashInterestAccountResult {
    pub account_id: String,
    pub account_name: String,
    pub created: usize,
    pub amended: usize,
    pub removed: usize,
    pub skipped: usize,
    pub skipped_overrides: usize,
    pub skipped_duplicates: usize,
}

#[async_trait]
pub trait InterestAccrualServiceTrait: Send + Sync {
    async fn sync(&self) -> Result<CashInterestSyncResult>;
    async fn sync_account(&self, account_id: &str) -> Result<CashInterestSyncResult>;
    async fn remove_auto_created(&self) -> Result<usize>;
    /// App-wide MP2 dividend rates, shared by every MP2 account.
    fn get_mp2_rates(&self) -> Result<Mp2DividendRates>;
    async fn set_mp2_rates(&self, rates: &Mp2DividendRates) -> Result<()>;
}

pub struct InterestAccrualService {
    accounts: Arc<dyn AccountServiceTrait>,
    activities: Arc<dyn ActivityServiceTrait>,
    settings: Arc<dyn SettingsServiceTrait>,
}

impl InterestAccrualService {
    pub fn new(
        accounts: Arc<dyn AccountServiceTrait>,
        activities: Arc<dyn ActivityServiceTrait>,
        settings: Arc<dyn SettingsServiceTrait>,
    ) -> Self {
        Self {
            accounts,
            activities,
            settings,
        }
    }

    /// Interest is earned per calendar day as the user sees it, not per UTC day.
    fn user_timezone(&self) -> Tz {
        let raw = self
            .settings
            .get_settings()
            .map(|s| s.timezone)
            .unwrap_or_default();
        parse_user_timezone_or_default(&raw)
    }

    fn load_rates(&self) -> Result<Mp2DividendRates> {
        match self.settings.get_setting_value(SETTINGS_KEY)? {
            Some(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
            None => Ok(Mp2DividendRates::default()),
        }
    }

    fn describe(planned: &PlannedActivity) -> String {
        let label = match planned.kind {
            PlannedKind::Interest => "Auto-created cash interest",
            PlannedKind::Payout => "Auto-created MP2 annual dividend payout",
        };
        let pct = (planned.rate * Decimal::from(100)).round_dp(4).normalize();
        if planned.estimated {
            format!("{label} — estimated at {pct}%, rate not yet declared")
        } else {
            format!("{label} — {pct}% declared")
        }
    }

    fn metadata(planned: &PlannedActivity, compounding: bool) -> String {
        serde_json::json!({
            "auto_generated": true,
            "compounding": compounding,
            "credit_date": planned.date.format("%Y-%m-%d").to_string(),
            "rate": planned.rate.to_string(),
            "estimated": planned.estimated,
        })
        .to_string()
    }

    fn new_activity(
        account_id: &str,
        currency: &str,
        planned: &PlannedActivity,
        compounding: bool,
    ) -> NewActivity {
        let ymd = planned.date.format("%Y-%m-%d").to_string();
        let activity_type = match planned.kind {
            PlannedKind::Interest => ACTIVITY_TYPE_INTEREST,
            PlannedKind::Payout => ACTIVITY_TYPE_WITHDRAWAL,
        };
        let notes = Self::describe(planned);
        let metadata = Self::metadata(planned, compounding);
        NewActivity {
            id: None,
            account_id: account_id.to_string(),
            asset: None,
            activity_type: activity_type.to_string(),
            subtype: None,
            activity_date: ymd,
            quantity: None,
            unit_price: None,
            currency: currency.to_string(),
            fee: Some(Decimal::ZERO),
            tax: Some(planned.tax),
            amount: Some(planned.amount),
            status: Some(ActivityStatus::Posted),
            notes: Some(notes),
            fx_rate: None,
            metadata: Some(metadata),
            needs_review: Some(false),
            source_system: Some(SOURCE_SYSTEM.to_string()),
            source_record_id: Some(planned.idempotency_key.clone()),
            source_group_id: None,
            idempotency_key: Some(planned.idempotency_key.clone()),
            import_run_id: None,
        }
    }

    fn amend_activity(
        account_id: &str,
        currency: &str,
        amendment: &PlannedAmendment,
        compounding: bool,
    ) -> ActivityUpdate {
        let planned = &amendment.planned;
        let activity_type = match planned.kind {
            PlannedKind::Interest => ACTIVITY_TYPE_INTEREST,
            PlannedKind::Payout => ACTIVITY_TYPE_WITHDRAWAL,
        };
        ActivityUpdate {
            id: amendment.activity_id.clone(),
            account_id: account_id.to_string(),
            asset: None,
            activity_type: activity_type.to_string(),
            subtype: None,
            activity_date: planned.date.format("%Y-%m-%d").to_string(),
            quantity: None,
            unit_price: None,
            currency: currency.to_string(),
            fee: Some(Some(Decimal::ZERO)),
            tax: Some(Some(planned.tax)),
            amount: Some(Some(planned.amount)),
            status: Some(ActivityStatus::Posted),
            notes: Some(Self::describe(planned)),
            fx_rate: None,
            metadata: Some(Self::metadata(planned, compounding)),
        }
    }

    async fn sync_inner(&self, account_id: Option<&str>) -> Result<CashInterestSyncResult> {
        let mut result = CashInterestSyncResult::default();
        let tz = self.user_timezone();
        let today = activity_date_in_tz(Utc::now(), tz);
        let rates = self.load_rates()?;
        let accounts = if let Some(id) = account_id {
            vec![self.accounts.get_account(id)?]
        } else {
            self.accounts.get_all_accounts()?
        };

        let mut creates = Vec::new();
        let mut updates = Vec::new();
        let mut delete_ids: Vec<String> = Vec::new();
        let mut net_cash = Decimal::ZERO;
        for account in accounts {
            if account.account_type != account_types::CASH {
                continue;
            }
            if !account.is_active || account.is_archived {
                continue;
            }
            let Some(product) = account.cash_product() else {
                continue;
            };
            let Some(yield_cfg) = product.yield_config.as_ref() else {
                continue;
            };
            if !yield_cfg.enabled {
                continue;
            }

            let activities = self.activities.get_activities_by_account_id(&account.id)?;
            let events: Vec<CashLedgerEvent> = activities
                .iter()
                .filter_map(|a| CashLedgerEvent::from_activity(a, tz))
                .collect();
            let planned = plan_interest(&account.id, &product, &rates, &events, today);
            let mut acct_result = CashInterestAccountResult {
                account_id: account.id.clone(),
                account_name: account.name.clone(),
                ..Default::default()
            };
            if planned.is_empty() {
                result.accounts.push(acct_result);
                continue;
            }
            for item in &planned.creates {
                if item.kind == PlannedKind::Interest {
                    net_cash += item.net();
                }
                creates.push(Self::new_activity(
                    &account.id,
                    &account.currency,
                    item,
                    product.compounding,
                ));
                acct_result.created += 1;
            }
            for item in &planned.amendments {
                if item.planned.kind == PlannedKind::Interest {
                    net_cash += item.planned.net() - (item.previous_amount - item.previous_tax);
                }
                updates.push(Self::amend_activity(
                    &account.id,
                    &account.currency,
                    item,
                    product.compounding,
                ));
                acct_result.amended += 1;
            }
            acct_result.removed = planned.removals.len();
            for removal in &planned.removals {
                net_cash -= removal.cash_delta;
                delete_ids.push(removal.activity_id.clone());
            }
            result.created += acct_result.created;
            result.amended += acct_result.amended;
            result.removed += acct_result.removed;
            result.accounts.push(acct_result);
        }

        if !creates.is_empty() || !updates.is_empty() || !delete_ids.is_empty() {
            let save = self
                .activities
                .bulk_mutate_activities(ActivityBulkMutationRequest {
                    creates,
                    updates,
                    delete_ids,
                })
                .await?;
            result.created = save.created.len();
            result.amended = save.updated.len();
            result.removed = save.deleted.len();
            for err in save.errors {
                result.errors.push(err.message);
            }
            info!(
                "Cash interest sync created {}, amended {}, removed {} activities",
                result.created, result.amended, result.removed
            );
        }
        result.net_cash_added = net_cash.round_dp(2).to_string();
        Ok(result)
    }
}

#[async_trait]
impl InterestAccrualServiceTrait for InterestAccrualService {
    async fn sync(&self) -> Result<CashInterestSyncResult> {
        self.sync_inner(None).await
    }

    async fn sync_account(&self, account_id: &str) -> Result<CashInterestSyncResult> {
        self.sync_inner(Some(account_id)).await
    }

    fn get_mp2_rates(&self) -> Result<Mp2DividendRates> {
        self.load_rates()
    }

    async fn set_mp2_rates(&self, rates: &Mp2DividendRates) -> Result<()> {
        let json = serde_json::to_string(rates).map_err(|e| {
            crate::errors::Error::Unexpected(format!("serialize MP2 dividend rates: {e}"))
        })?;
        self.settings.set_setting_value(SETTINGS_KEY, &json).await
    }

    async fn remove_auto_created(&self) -> Result<usize> {
        let accounts = self.accounts.get_all_accounts()?;
        let mut delete_ids = Vec::new();
        for account in accounts {
            for a in self.activities.get_activities_by_account_id(&account.id)? {
                if a.is_user_modified {
                    continue;
                }
                let ty = a.effective_type();
                if ty != ACTIVITY_TYPE_INTEREST && ty != ACTIVITY_TYPE_WITHDRAWAL {
                    continue;
                }
                if is_auto_interest_source(a.source_system.as_deref())
                    || is_auto_interest_key(a.idempotency_key.as_deref())
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
}
