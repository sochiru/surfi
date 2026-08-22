pub const SOURCE_SYSTEM: &str = "CASH_INTEREST_ACCRUAL";
pub const IDEMPOTENCY_PREFIX: &str = "cash-int:";
pub const IDEMPOTENCY_PAYOUT_INFIX: &str = "cash-int-payout:";

pub fn build_idempotency_key(account_id: &str, ymd: &str) -> String {
    format!("{IDEMPOTENCY_PREFIX}{account_id}:{ymd}")
}

pub fn build_payout_idempotency_key(account_id: &str, ymd: &str) -> String {
    format!("{IDEMPOTENCY_PAYOUT_INFIX}{account_id}:{ymd}")
}

pub fn is_auto_interest_source(source_system: Option<&str>) -> bool {
    source_system == Some(SOURCE_SYSTEM)
}

pub fn is_auto_interest_key(key: Option<&str>) -> bool {
    key.is_some_and(|k| {
        k.starts_with(IDEMPOTENCY_PREFIX) || k.starts_with(IDEMPOTENCY_PAYOUT_INFIX)
    })
}
