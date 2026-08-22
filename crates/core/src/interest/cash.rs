use chrono::NaiveDate;
use chrono_tz::Tz;
use rust_decimal::Decimal;

use crate::activities::{
    Activity, ActivityStatus, ACTIVITY_TYPE_BUY, ACTIVITY_TYPE_CREDIT, ACTIVITY_TYPE_DEPOSIT,
    ACTIVITY_TYPE_DIVIDEND, ACTIVITY_TYPE_FEE, ACTIVITY_TYPE_INTEREST, ACTIVITY_TYPE_SELL,
    ACTIVITY_TYPE_TAX, ACTIVITY_TYPE_TRANSFER_IN, ACTIVITY_TYPE_TRANSFER_OUT,
    ACTIVITY_TYPE_WITHDRAWAL,
};

use crate::utils::time_utils::activity_date_in_tz;

use super::model::{is_auto_interest_key, is_auto_interest_source};

#[derive(Debug, Clone)]
pub struct CashLedgerEvent {
    pub id: String,
    pub date: NaiveDate,
    pub activity_type: String,
    pub amount: Decimal,
    pub fee: Decimal,
    /// Withholding deducted before the cash lands.
    pub tax: Decimal,
    pub source_system: Option<String>,
    pub idempotency_key: Option<String>,
    pub is_user_modified: bool,
}

impl CashLedgerEvent {
    /// `tz` is the user's timezone. Interest is earned per calendar day as the user
    /// sees it, so a deposit made just after midnight local must not be dated to the
    /// previous UTC day and earn an extra day.
    pub fn from_activity(activity: &Activity, tz: Tz) -> Option<Self> {
        if activity.status != ActivityStatus::Posted {
            return None;
        }
        Some(Self {
            id: activity.id.clone(),
            date: activity_date_in_tz(activity.activity_date, tz),
            activity_type: activity.effective_type().to_string(),
            amount: activity.amt(),
            fee: activity.fee_amt(),
            tax: activity.tax_amt(),
            source_system: activity.source_system.clone(),
            idempotency_key: activity.idempotency_key.clone(),
            is_user_modified: activity.is_user_modified,
        })
    }

    pub fn signed_cash_delta(&self) -> Decimal {
        // Withholding reduces the settled cash exactly as the snapshot calculator
        // books it, so the balance we compound on matches the portfolio engine.
        signed_cash_delta(&self.activity_type, self.amount, self.fee + self.tax)
    }

    pub fn is_interest(&self) -> bool {
        self.activity_type == ACTIVITY_TYPE_INTEREST
    }

    pub fn is_withdrawal(&self) -> bool {
        self.activity_type == ACTIVITY_TYPE_WITHDRAWAL
    }

    /// True for anything this service created, including the WITHDRAWAL rows
    /// that mirror a non-compounding annual payout.
    pub fn is_auto_generated(&self) -> bool {
        is_auto_interest_source(self.source_system.as_deref())
            || is_auto_interest_key(self.idempotency_key.as_deref())
    }

    pub fn is_auto_interest(&self) -> bool {
        self.is_interest() && self.is_auto_generated()
    }

    /// Auto rows we are still allowed to correct in place.
    pub fn is_amendable(&self) -> bool {
        self.is_auto_generated() && !self.is_user_modified
    }

    pub fn is_interest_override(&self) -> bool {
        self.is_interest() && (!self.is_auto_interest() || self.is_user_modified)
    }
}

pub fn signed_cash_delta(activity_type: &str, amount: Decimal, fee: Decimal) -> Decimal {
    let amt = amount.abs();
    let fee = fee.abs();
    match activity_type {
        ACTIVITY_TYPE_DEPOSIT
        | ACTIVITY_TYPE_INTEREST
        | ACTIVITY_TYPE_DIVIDEND
        | ACTIVITY_TYPE_TRANSFER_IN
        | ACTIVITY_TYPE_CREDIT
        | ACTIVITY_TYPE_SELL => amt - fee,
        ACTIVITY_TYPE_WITHDRAWAL | ACTIVITY_TYPE_TRANSFER_OUT | ACTIVITY_TYPE_BUY => -(amt + fee),
        ACTIVITY_TYPE_FEE | ACTIVITY_TYPE_TAX => {
            if amt > Decimal::ZERO {
                -amt
            } else {
                -fee
            }
        }
        _ => Decimal::ZERO,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn deposit_increases_and_withdrawal_decreases() {
        assert_eq!(
            signed_cash_delta(ACTIVITY_TYPE_DEPOSIT, dec!(100), Decimal::ZERO),
            dec!(100)
        );
        assert_eq!(
            signed_cash_delta(ACTIVITY_TYPE_WITHDRAWAL, dec!(40), Decimal::ZERO),
            dec!(-40)
        );
        assert_eq!(
            signed_cash_delta(ACTIVITY_TYPE_INTEREST, dec!(2.5), Decimal::ZERO),
            dec!(2.5)
        );
    }
}
