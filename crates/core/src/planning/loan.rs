//! Standard monthly installment amortization (30/360).
//!
//! Used to project liability balances from origination (or the first statement)
//! through today. Revolving products are out of scope.

use chrono::{Datelike, NaiveDate};
use num_traits::ToPrimitive;
use rust_decimal::Decimal;
use rust_decimal::MathematicalOps;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Annual interest rate as a percent (e.g. `3.5` for 3.5%).
pub type AnnualRatePercent = Decimal;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RatePeriod {
    pub effective_from: NaiveDate,
    pub rate: AnnualRatePercent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoanTerms {
    pub annual_rate: AnnualRatePercent,
    pub rate_schedule: Vec<RatePeriod>,
    pub monthly_payment: Option<Decimal>,
    pub original_term_months: u32,
    pub payment_day: u32,
    pub lock_in_end_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmortizationStep {
    pub date: NaiveDate,
    pub balance: Decimal,
    pub interest: Decimal,
    pub principal: Decimal,
    pub payment: Decimal,
    pub remaining_term_months: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PauseReason {
    LockInEnded { ended_on: NaiveDate },
    AnnualRateUpdateDue { due_on: NaiveDate },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Projection {
    pub steps: Vec<AmortizationStep>,
    pub pause: Option<PauseReason>,
}

const MONEY_DP: u32 = 2;
const MAX_TERM_MONTHS: u32 = 720;

/// Revolving products stay snapshot-only.
pub fn is_revolving_subtype(sub_type: &str) -> bool {
    matches!(sub_type, "credit_card" | "heloc")
}

/// Monthly rate from an annual percent (3.5 → 0.035 / 12).
pub fn monthly_rate(annual_percent: AnnualRatePercent) -> Decimal {
    annual_percent / Decimal::from(100) / Decimal::from(12)
}

/// Standard fixed payment: `P * r(1+r)^n / ((1+r)^n - 1)`. Zero rate → `P / n`.
pub fn standard_payment(principal: Decimal, annual_percent: AnnualRatePercent, n: u32) -> Decimal {
    if principal <= Decimal::ZERO || n == 0 {
        return Decimal::ZERO;
    }
    let r = monthly_rate(annual_percent);
    if r.is_zero() {
        return (principal / Decimal::from(n)).round_dp(MONEY_DP);
    }
    let one_plus_r = Decimal::ONE + r;
    let factor = one_plus_r.powd(Decimal::from(n));
    let denom = factor - Decimal::ONE;
    if denom.is_zero() {
        return (principal / Decimal::from(n)).round_dp(MONEY_DP);
    }
    (principal * r * factor / denom).round_dp(MONEY_DP)
}

/// Solve remaining term in months from principal, rate, and payment.
pub fn solve_remaining_term(
    principal: Decimal,
    annual_percent: AnnualRatePercent,
    payment: Decimal,
) -> u32 {
    if principal <= Decimal::ZERO || payment <= Decimal::ZERO {
        return 0;
    }
    let r = monthly_rate(annual_percent);
    if r.is_zero() {
        let n = (principal / payment).ceil();
        return n.to_u32().unwrap_or(MAX_TERM_MONTHS).min(MAX_TERM_MONTHS);
    }
    let interest_only = principal * r;
    if payment <= interest_only {
        return MAX_TERM_MONTHS;
    }
    let numer = (payment / (payment - interest_only)).ln();
    let denom = (Decimal::ONE + r).ln();
    if denom.is_zero() {
        return MAX_TERM_MONTHS;
    }
    let n = (numer / denom).round();
    n.to_u32()
        .unwrap_or(MAX_TERM_MONTHS)
        .clamp(1, MAX_TERM_MONTHS)
}

/// Latest schedule rate with `effective_from <= date`, else `annual_rate`.
pub fn rate_on(terms: &LoanTerms, date: NaiveDate) -> AnnualRatePercent {
    let mut best: Option<&RatePeriod> = None;
    for period in &terms.rate_schedule {
        if period.effective_from <= date {
            match best {
                None => best = Some(period),
                Some(current) if period.effective_from >= current.effective_from => {
                    best = Some(period);
                }
                _ => {}
            }
        }
    }
    best.map(|p| p.rate).unwrap_or(terms.annual_rate)
}

fn anniversary(date: NaiveDate) -> NaiveDate {
    date.with_year(date.year() + 1)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(date.year() + 1, 2, 28).unwrap())
}

fn pause_reason(terms: &LoanTerms, payment_date: NaiveDate) -> Option<PauseReason> {
    let ended_on = terms.lock_in_end_date?;
    if payment_date <= ended_on {
        return None;
    }

    let latest_adjustment = terms
        .rate_schedule
        .iter()
        .filter(|period| {
            period.effective_from >= ended_on && period.effective_from <= payment_date
        })
        .max_by_key(|period| period.effective_from);

    let Some(latest_adjustment) = latest_adjustment else {
        return Some(PauseReason::LockInEnded { ended_on });
    };

    let due_on = anniversary(latest_adjustment.effective_from);
    (payment_date >= due_on).then_some(PauseReason::AnnualRateUpdateDue { due_on })
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let this_first = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let next_first = NaiveDate::from_ymd_opt(next_year, next_month, 1).unwrap();
    (next_first - this_first).num_days() as u32
}

fn clamp_payment_day(day: u32) -> u32 {
    day.clamp(1, 28)
}

fn date_on_payment_day(year: i32, month: u32, payment_day: u32) -> NaiveDate {
    let day = clamp_payment_day(payment_day).min(days_in_month(year, month));
    NaiveDate::from_ymd_opt(year, month, day).expect("valid payment date")
}

/// First payment is one month after `from` on `payment_day`.
pub fn next_payment_date(from: NaiveDate, payment_day: u32) -> NaiveDate {
    let (year, month) = if from.month() == 12 {
        (from.year() + 1, 1)
    } else {
        (from.year(), from.month() + 1)
    };
    date_on_payment_day(year, month, payment_day)
}

/// Project amortized balances from `start` through `as_of`.
///
/// MANUAL `statements` rebase principal on that date without erasing earlier steps.
/// A statement on a payment date replaces that month's calculated payment.
pub fn project(
    start: NaiveDate,
    start_principal: Decimal,
    terms: &LoanTerms,
    statements: &[(NaiveDate, Decimal)],
    as_of: NaiveDate,
) -> Projection {
    if as_of < start || start_principal <= Decimal::ZERO {
        return Projection {
            steps: vec![],
            pause: None,
        };
    }

    let mut statements: Vec<(NaiveDate, Decimal)> = statements
        .iter()
        .copied()
        .filter(|(d, _)| *d >= start && *d <= as_of)
        .collect();
    statements.sort_by_key(|(d, _)| *d);

    let mut stmt_idx = 0;
    let mut balance = start_principal;
    while stmt_idx < statements.len() && statements[stmt_idx].0 == start {
        balance = statements[stmt_idx].1;
        stmt_idx += 1;
    }

    let mut remaining_n = terms.original_term_months;
    let mut current_rate = rate_on(terms, start);
    let mut pmt = match terms.monthly_payment {
        Some(payment) if payment > Decimal::ZERO => {
            if remaining_n == 0 {
                remaining_n = solve_remaining_term(balance, current_rate, payment);
            }
            payment.round_dp(MONEY_DP)
        }
        _ => standard_payment(balance, current_rate, remaining_n),
    };

    let mut steps = Vec::new();
    let mut pause = None;
    let mut date = next_payment_date(start, terms.payment_day);

    while date <= as_of && balance > Decimal::ZERO && remaining_n > 0 {
        while stmt_idx < statements.len() && statements[stmt_idx].0 < date {
            balance = statements[stmt_idx].1;
            stmt_idx += 1;
        }

        if stmt_idx < statements.len() && statements[stmt_idx].0 == date {
            balance = statements[stmt_idx].1;
            stmt_idx += 1;
            remaining_n = remaining_n.saturating_sub(1);
            date = next_payment_date(date, terms.payment_day);
            continue;
        }

        if let Some(reason) = pause_reason(terms, date) {
            pause = Some(reason);
            break;
        }

        let rate = rate_on(terms, date);
        if rate != current_rate {
            current_rate = rate;
            pmt = standard_payment(balance, current_rate, remaining_n);
        }

        let r = monthly_rate(current_rate);
        let interest = (balance * r).round_dp(MONEY_DP);
        let mut principal = pmt - interest;
        if principal > balance {
            principal = balance;
        }
        if principal < Decimal::ZERO {
            principal = Decimal::ZERO;
        }
        let payment = (principal + interest).round_dp(MONEY_DP);
        balance = (balance - principal).round_dp(MONEY_DP);
        remaining_n = remaining_n.saturating_sub(1);

        steps.push(AmortizationStep {
            date,
            balance,
            interest,
            principal,
            payment,
            remaining_term_months: remaining_n,
        });

        if balance <= Decimal::ZERO {
            break;
        }
        date = next_payment_date(date, terms.payment_day);
    }

    Projection { steps, pause }
}

fn metadata_str(metadata: &Value, key: &str) -> Option<String> {
    metadata.get(key).and_then(|v| {
        v.as_str()
            .map(|s| s.to_string())
            .or_else(|| v.as_number().map(|n| n.to_string()))
    })
}

fn parse_decimal(raw: &str) -> Option<Decimal> {
    raw.parse().ok()
}

fn parse_date(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok()
}

/// Parse installment terms from asset metadata. Returns `None` when the loan
/// cannot be projected (revolving, or missing rate and payment/term).
pub fn loan_terms_from_metadata(metadata: &Value) -> Option<LoanTerms> {
    let sub_type = metadata_str(metadata, "sub_type")
        .or_else(|| metadata_str(metadata, "liability_type"))
        .unwrap_or_default();
    if is_revolving_subtype(&sub_type) {
        return None;
    }

    let annual_rate = metadata_str(metadata, "interest_rate").and_then(|s| parse_decimal(&s));
    let monthly_payment = metadata_str(metadata, "monthly_payment").and_then(|s| parse_decimal(&s));
    let original_term_months = metadata_str(metadata, "original_term_months")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let payment_day = metadata_str(metadata, "payment_day")
        .and_then(|s| s.parse::<u32>().ok())
        .map(clamp_payment_day)
        .unwrap_or(1);
    let lock_in_end_date = metadata_str(metadata, "lock_in_end_date").and_then(|s| parse_date(&s));

    let mut rate_schedule = parse_rate_schedule(metadata.get("rate_schedule"));
    if rate_schedule.is_empty() {
        if let Some(rate) = annual_rate {
            rate_schedule.push(RatePeriod {
                effective_from: NaiveDate::from_ymd_opt(1, 1, 1).unwrap(),
                rate,
            });
        }
    }

    let rate = annual_rate.or_else(|| rate_schedule.first().map(|p| p.rate))?;
    let has_payment = monthly_payment.is_some_and(|p| p > Decimal::ZERO);
    let has_term = original_term_months > 0;
    if !has_payment && !has_term {
        return None;
    }

    Some(LoanTerms {
        annual_rate: rate,
        rate_schedule,
        monthly_payment: monthly_payment.filter(|p| *p > Decimal::ZERO),
        original_term_months,
        payment_day,
        lock_in_end_date,
    })
}

fn parse_rate_schedule(value: Option<&Value>) -> Vec<RatePeriod> {
    let Some(value) = value else {
        return vec![];
    };
    let parsed = if let Some(s) = value.as_str() {
        serde_json::from_str::<Value>(s).ok()
    } else {
        Some(value.clone())
    };
    let Some(Value::Array(items)) = parsed else {
        return vec![];
    };

    let mut periods = Vec::new();
    for item in items {
        let effective_from = item
            .get("effective_from")
            .or_else(|| item.get("effectiveFrom"))
            .and_then(|v| v.as_str())
            .and_then(parse_date);
        let rate = item
            .get("rate")
            .and_then(|v| {
                v.as_str()
                    .map(|s| s.to_string())
                    .or_else(|| v.as_number().map(|n| n.to_string()))
            })
            .and_then(|s| parse_decimal(&s));
        if let (Some(effective_from), Some(rate)) = (effective_from, rate) {
            periods.push(RatePeriod {
                effective_from,
                rate,
            });
        }
    }
    periods.sort_by_key(|p| p.effective_from);
    periods
}

pub fn calculated_quote_id(asset_id: &str, date: NaiveDate) -> String {
    format!("{}_{}_CALCULATED", asset_id, date)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;
    use serde_json::json;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn terms(rate: Decimal, payment: Option<Decimal>, n: u32) -> LoanTerms {
        LoanTerms {
            annual_rate: rate,
            rate_schedule: vec![RatePeriod {
                effective_from: d(2000, 1, 1),
                rate,
            }],
            monthly_payment: payment,
            original_term_months: n,
            payment_day: 1,
            lock_in_end_date: None,
        }
    }

    #[test]
    fn standard_payment_matches_mortgage_formula() {
        // 300_000 at 3.5% for 360 months ≈ 1,347.13
        let pmt = standard_payment(dec!(300000), dec!(3.5), 360);
        assert_eq!(pmt, dec!(1347.13));
    }

    #[test]
    fn zero_rate_payment_is_principal_over_term() {
        assert_eq!(standard_payment(dec!(1200), dec!(0), 12), dec!(100.00));
    }

    #[test]
    fn solve_term_round_trips_payment() {
        let pmt = standard_payment(dec!(300000), dec!(3.5), 360);
        let n = solve_remaining_term(dec!(300000), dec!(3.5), pmt);
        assert_eq!(n, 360);
    }

    #[test]
    fn monthly_decay_from_origination() {
        let t = terms(dec!(3.5), None, 360);
        let projection = project(d(2020, 1, 1), dec!(300000), &t, &[], d(2020, 4, 1));
        assert_eq!(projection.steps.len(), 3);
        assert!(projection.steps[0].balance < dec!(300000));
        assert!(projection.steps[1].balance < projection.steps[0].balance);
        assert!(projection.steps[2].balance < projection.steps[1].balance);
        assert_eq!(projection.steps[0].date, d(2020, 2, 1));
        assert_eq!(projection.pause, None);
    }

    #[test]
    fn rate_change_mid_stream_recalculates_payment() {
        let t = LoanTerms {
            annual_rate: dec!(3.5),
            rate_schedule: vec![
                RatePeriod {
                    effective_from: d(2020, 1, 1),
                    rate: dec!(3.5),
                },
                RatePeriod {
                    effective_from: d(2020, 4, 1),
                    rate: dec!(5.0),
                },
            ],
            monthly_payment: None,
            original_term_months: 360,
            payment_day: 1,
            lock_in_end_date: None,
        };
        let projection = project(d(2020, 1, 1), dec!(300000), &t, &[], d(2020, 5, 1));
        let before = projection
            .steps
            .iter()
            .find(|s| s.date == d(2020, 3, 1))
            .unwrap();
        let after = projection
            .steps
            .iter()
            .find(|s| s.date == d(2020, 4, 1))
            .unwrap();
        assert!(after.payment > before.payment);
        assert_eq!(after.remaining_term_months, before.remaining_term_months - 1);
    }

    #[test]
    fn lock_in_pause_stops_after_end_without_new_rate() {
        let t = LoanTerms {
            annual_rate: dec!(3.5),
            rate_schedule: vec![RatePeriod {
                effective_from: d(2020, 1, 1),
                rate: dec!(3.5),
            }],
            monthly_payment: None,
            original_term_months: 360,
            payment_day: 1,
            lock_in_end_date: Some(d(2020, 3, 1)),
        };
        let projection = project(d(2020, 1, 1), dec!(300000), &t, &[], d(2020, 6, 1));
        assert_eq!(
            projection.pause,
            Some(PauseReason::LockInEnded {
                ended_on: d(2020, 3, 1)
            })
        );
        assert!(projection.steps.iter().all(|s| s.date <= d(2020, 3, 1)));
        assert!(projection.steps.iter().any(|s| s.date == d(2020, 3, 1)));
    }

    #[test]
    fn lock_in_resumes_when_new_rate_exists() {
        let t = LoanTerms {
            annual_rate: dec!(3.5),
            rate_schedule: vec![
                RatePeriod {
                    effective_from: d(2020, 1, 1),
                    rate: dec!(3.5),
                },
                RatePeriod {
                    effective_from: d(2020, 4, 1),
                    rate: dec!(4.0),
                },
            ],
            monthly_payment: None,
            original_term_months: 360,
            payment_day: 1,
            lock_in_end_date: Some(d(2020, 3, 1)),
        };
        let projection = project(d(2020, 1, 1), dec!(300000), &t, &[], d(2020, 5, 1));
        assert_eq!(projection.pause, None);
        assert!(projection.steps.iter().any(|s| s.date == d(2020, 4, 1)));
    }

    #[test]
    fn post_lock_in_rate_expires_after_one_year() {
        let t = LoanTerms {
            annual_rate: dec!(3.5),
            rate_schedule: vec![
                RatePeriod {
                    effective_from: d(2020, 1, 1),
                    rate: dec!(3.5),
                },
                RatePeriod {
                    effective_from: d(2020, 4, 1),
                    rate: dec!(4.0),
                },
            ],
            monthly_payment: None,
            original_term_months: 360,
            payment_day: 1,
            lock_in_end_date: Some(d(2020, 3, 1)),
        };
        let projection = project(d(2020, 1, 1), dec!(300000), &t, &[], d(2021, 5, 1));
        assert_eq!(
            projection.pause,
            Some(PauseReason::AnnualRateUpdateDue {
                due_on: d(2021, 4, 1)
            })
        );
        assert!(projection.steps.iter().all(|s| s.date < d(2021, 4, 1)));
    }

    #[test]
    fn yearly_rate_entry_resumes_until_next_anniversary() {
        let t = LoanTerms {
            annual_rate: dec!(3.5),
            rate_schedule: vec![
                RatePeriod {
                    effective_from: d(2020, 1, 1),
                    rate: dec!(3.5),
                },
                RatePeriod {
                    effective_from: d(2020, 4, 1),
                    rate: dec!(4.0),
                },
                RatePeriod {
                    effective_from: d(2021, 4, 1),
                    rate: dec!(4.5),
                },
            ],
            monthly_payment: None,
            original_term_months: 360,
            payment_day: 1,
            lock_in_end_date: Some(d(2020, 3, 1)),
        };
        let projection = project(d(2020, 1, 1), dec!(300000), &t, &[], d(2021, 5, 1));
        assert_eq!(projection.pause, None);
        assert!(projection.steps.iter().any(|s| s.date == d(2021, 5, 1)));
    }

    #[test]
    fn manual_statement_rebases_without_wiping_earlier_steps() {
        let t = terms(dec!(3.5), None, 360);
        let statements = vec![(d(2020, 4, 1), dec!(250000))];
        let projection = project(d(2020, 1, 1), dec!(300000), &t, &statements, d(2020, 6, 1));
        let before = projection
            .steps
            .iter()
            .find(|s| s.date == d(2020, 3, 1))
            .unwrap();
        assert!(before.balance > dec!(250000));
        assert!(
            !projection
                .steps
                .iter()
                .any(|s| s.date == d(2020, 4, 1))
        );
        let after = projection
            .steps
            .iter()
            .find(|s| s.date == d(2020, 5, 1))
            .unwrap();
        assert!(after.balance < dec!(250000));
        assert_eq!((after.balance + after.principal).round_dp(2), dec!(250000));
    }

    #[test]
    fn payment_wins_over_term() {
        let low_pmt = standard_payment(dec!(300000), dec!(3.5), 360);
        let t = terms(dec!(3.5), Some(low_pmt), 180);
        let projection = project(d(2020, 1, 1), dec!(300000), &t, &[], d(2020, 2, 1));
        assert_eq!(projection.steps[0].payment, low_pmt);
    }

    #[test]
    fn skips_revolving_metadata() {
        let meta = json!({
            "sub_type": "credit_card",
            "interest_rate": "19.9",
            "monthly_payment": "200"
        });
        assert!(loan_terms_from_metadata(&meta).is_none());
    }

    #[test]
    fn parses_installment_metadata() {
        let meta = json!({
            "sub_type": "mortgage",
            "interest_rate": "3.5",
            "original_term_months": "360",
            "payment_day": "15",
            "monthly_payment": "1347.13"
        });
        let terms = loan_terms_from_metadata(&meta).unwrap();
        assert_eq!(terms.annual_rate, dec!(3.5));
        assert_eq!(terms.original_term_months, 360);
        assert_eq!(terms.payment_day, 15);
        assert_eq!(terms.monthly_payment, Some(dec!(1347.13)));
    }
}
