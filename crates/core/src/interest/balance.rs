use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::collections::BTreeMap;

use crate::activities::{
    Activity, ACTIVITY_TYPE_CREDIT, ACTIVITY_TYPE_DEPOSIT, ACTIVITY_TYPE_DIVIDEND,
    ACTIVITY_TYPE_INTEREST, ACTIVITY_TYPE_TRANSFER_IN, ACTIVITY_TYPE_TRANSFER_OUT,
    ACTIVITY_TYPE_WITHDRAWAL,
};

/// Replay posted cash activities into end-of-day balances (account currency).
pub fn end_of_day_balances(
    activities: &[Activity],
    currency: &str,
) -> BTreeMap<NaiveDate, Decimal> {
    let mut sorted: Vec<&Activity> = activities
        .iter()
        .filter(|a| a.is_posted() && a.currency.eq_ignore_ascii_case(currency))
        .collect();
    sorted.sort_by_key(|a| (a.effective_date(), &a.id));

    let mut balance = Decimal::ZERO;
    let mut by_day: BTreeMap<NaiveDate, Decimal> = BTreeMap::new();

    for activity in sorted {
        balance += cash_delta(activity);
        by_day.insert(activity.effective_date(), balance);
    }

    by_day
}

pub fn balance_on_date(
    activities: &[Activity],
    currency: &str,
    on_or_before: NaiveDate,
) -> Decimal {
    let mut balance = Decimal::ZERO;
    let mut sorted: Vec<&Activity> = activities
        .iter()
        .filter(|a| {
            a.is_posted()
                && a.currency.eq_ignore_ascii_case(currency)
                && a.effective_date() <= on_or_before
        })
        .collect();
    sorted.sort_by_key(|a| (a.effective_date(), &a.id));
    for activity in sorted {
        balance += cash_delta(activity);
    }
    balance
}

pub fn contributions_between(
    activities: &[Activity],
    currency: &str,
    start: NaiveDate,
    end: NaiveDate,
) -> Decimal {
    activities
        .iter()
        .filter(|a| {
            a.is_posted()
                && a.currency.eq_ignore_ascii_case(currency)
                && a.effective_type() == ACTIVITY_TYPE_DEPOSIT
                && a.effective_date() >= start
                && a.effective_date() <= end
        })
        .map(|a| a.amt() - a.fee_amt() - a.tax_amt())
        .sum()
}

fn cash_delta(activity: &Activity) -> Decimal {
    if activity.asset_id.is_some() {
        return Decimal::ZERO;
    }

    let net = activity.amt() - activity.fee_amt() - activity.tax_amt();
    match activity.effective_type() {
        ACTIVITY_TYPE_DEPOSIT
        | ACTIVITY_TYPE_INTEREST
        | ACTIVITY_TYPE_DIVIDEND
        | ACTIVITY_TYPE_TRANSFER_IN => net,
        ACTIVITY_TYPE_WITHDRAWAL | ACTIVITY_TYPE_TRANSFER_OUT => -net,
        ACTIVITY_TYPE_CREDIT => net,
        _ => Decimal::ZERO,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activities::{Activity, ActivityStatus};
    use chrono::Utc;

    fn cash_activity(id: &str, date: &str, activity_type: &str, amount: i64) -> Activity {
        Activity {
            id: id.to_string(),
            account_id: "acct".to_string(),
            asset_id: None,
            activity_type: activity_type.to_string(),
            activity_type_override: None,
            source_type: None,
            subtype: None,
            status: ActivityStatus::Posted,
            activity_date: NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc(),
            settlement_date: None,
            quantity: None,
            unit_price: None,
            amount: Some(Decimal::from(amount)),
            fee: Some(Decimal::ZERO),
            tax: Some(Decimal::ZERO),
            currency: "PHP".to_string(),
            fx_rate: None,
            notes: None,
            metadata: None,
            source_system: None,
            source_record_id: None,
            source_group_id: None,
            idempotency_key: None,
            import_run_id: None,
            is_user_modified: false,
            needs_review: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn tracks_deposit_and_interest() {
        let activities = vec![
            cash_activity("1", "2024-01-01", ACTIVITY_TYPE_DEPOSIT, 1000),
            cash_activity("2", "2024-12-31", ACTIVITY_TYPE_INTEREST, 50),
        ];
        assert_eq!(
            balance_on_date(&activities, "PHP", NaiveDate::from_ymd_opt(2024, 6, 1).unwrap()),
            Decimal::from(1000)
        );
        assert_eq!(
            balance_on_date(&activities, "PHP", NaiveDate::from_ymd_opt(2024, 12, 31).unwrap()),
            Decimal::from(1050)
        );
    }
}
