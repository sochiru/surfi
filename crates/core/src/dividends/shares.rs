use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use rust_decimal::Decimal;

#[derive(Debug, Clone)]
pub struct TradeLikeActivity {
    pub activity_type: String,
    pub activity_date: DateTime<Utc>,
    pub quantity: Decimal,
}

/// Best-effort shares held at ex-date from BUY/SELL/SPLIT/TRANSFER history.
/// Only activities strictly before the ex-date midnight UTC are counted.
pub fn compute_shares_at_ex_date(activities: &[TradeLikeActivity], ex_date: NaiveDate) -> Decimal {
    let ex_dt = Utc.from_utc_datetime(&ex_date.and_hms_opt(0, 0, 0).unwrap_or_default());
    let mut shares = Decimal::ZERO;

    let mut ordered = activities.to_vec();
    ordered.sort_by_key(|a| a.activity_date);

    for act in ordered {
        if act.activity_date >= ex_dt {
            break;
        }
        let qty = act.quantity.abs();
        let ty = act.activity_type.to_ascii_uppercase();
        match ty.as_str() {
            "BUY" | "TRANSFER_IN" => shares += qty,
            "SELL" | "TRANSFER_OUT" => shares -= qty,
            // Treat quantity as a multiplier when it looks like one.
            "SPLIT" if qty > Decimal::ZERO && qty < Decimal::from(100) && qty != Decimal::ONE => {
                shares *= qty;
            }
            _ => {}
        }
    }

    if shares > Decimal::new(1, 8) {
        shares
    } else {
        Decimal::ZERO
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn trade(ty: &str, ymd: &str, qty: i64) -> TradeLikeActivity {
        let d = NaiveDate::parse_from_str(ymd, "%Y-%m-%d").unwrap();
        TradeLikeActivity {
            activity_type: ty.to_string(),
            activity_date: Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap()),
            quantity: Decimal::from(qty),
        }
    }

    #[test]
    fn nets_buys_and_sells_before_ex_date() {
        let trades = vec![
            trade("BUY", "2024-01-01", 100),
            trade("SELL", "2024-02-01", 40),
            trade("BUY", "2024-06-01", 10),
        ];
        let ex = NaiveDate::parse_from_str("2024-03-15", "%Y-%m-%d").unwrap();
        assert_eq!(compute_shares_at_ex_date(&trades, ex), Decimal::from(60));
    }

    #[test]
    fn ignores_shares_bought_after_ex_date() {
        let trades = vec![
            trade("BUY", "2024-01-01", 1000),
            trade("BUY", "2024-05-01", 9000),
        ];
        let feb = NaiveDate::parse_from_str("2024-02-01", "%Y-%m-%d").unwrap();
        let jun = NaiveDate::parse_from_str("2024-06-01", "%Y-%m-%d").unwrap();
        assert_eq!(compute_shares_at_ex_date(&trades, feb), Decimal::from(1000));
        assert_eq!(
            compute_shares_at_ex_date(&trades, jun),
            Decimal::from(10000)
        );
    }

    #[test]
    fn returns_zero_when_not_held() {
        let trades = vec![trade("BUY", "2024-06-01", 10)];
        let ex = NaiveDate::parse_from_str("2024-03-15", "%Y-%m-%d").unwrap();
        assert_eq!(compute_shares_at_ex_date(&trades, ex), Decimal::ZERO);
    }
}
