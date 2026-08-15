use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Core-generated market-data dividends.
pub const SOURCE_SYSTEM: &str = "MARKET_DATA_DIVIDEND";
/// Legacy PSE addon activities (recognized for cleanup / dedupe).
pub const SOURCE_SYSTEM_LEGACY_ADDON: &str = "PSE_DIVIDEND_ADDON";
pub const IDEMPOTENCY_PREFIX: &str = "mkt-div:";
pub const IDEMPOTENCY_PREFIX_LEGACY: &str = "pse-div:";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DividendSyncResult {
    pub created: usize,
    pub skipped: usize,
    pub skipped_no_shares: usize,
    pub skipped_duplicates: usize,
    pub accounts: Vec<DividendSyncAccountResult>,
    pub errors: Vec<String>,
    /// Net cash booked across all created activities (gross − tax), for toast UX.
    pub net_cash_added: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DividendSyncAccountResult {
    pub account_id: String,
    pub account_name: String,
    pub created: usize,
    pub skipped_no_shares: usize,
    pub skipped_duplicates: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DividendCalendarEventKind {
    Posted,
    PastUnposted,
    UpcomingEstimated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DividendCalendarEvent {
    pub id: String,
    /// YYYY-MM-DD
    pub date: String,
    pub symbol: String,
    pub account_id: String,
    pub account_name: String,
    pub display_amount: Decimal,
    pub currency: String,
    pub kind: DividendCalendarEventKind,
    pub activity_id: Option<String>,
    pub notes: Option<String>,
}

pub fn build_idempotency_key(
    account_id: &str,
    asset_id: &str,
    ex_date_ymd: &str,
    rounded_amount: &str,
) -> String {
    format!("{IDEMPOTENCY_PREFIX}{account_id}:{asset_id}:{ex_date_ymd}:{rounded_amount}")
}

pub fn round_amount_str(amount: f64, decimals: u32) -> String {
    let factor = 10f64.powi(decimals as i32);
    let rounded = (amount * factor).round() / factor;
    format!("{:.prec$}", rounded, prec = decimals as usize)
}

pub fn is_auto_dividend_source(source_system: Option<&str>) -> bool {
    matches!(
        source_system,
        Some(SOURCE_SYSTEM) | Some(SOURCE_SYSTEM_LEGACY_ADDON)
    )
}

pub fn is_auto_dividend_key(key: Option<&str>) -> bool {
    key.is_some_and(|k| {
        k.starts_with(IDEMPOTENCY_PREFIX) || k.starts_with(IDEMPOTENCY_PREFIX_LEGACY)
    })
}
