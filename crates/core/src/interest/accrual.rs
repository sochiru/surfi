use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use rust_decimal::RoundingStrategy;
use std::collections::{HashMap, HashSet};

use super::cash::CashLedgerEvent;
use super::model::{build_idempotency_key, build_payout_idempotency_key};
use super::product::{
    is_year_end, yield_start_date, CashProduct, CashProductType, CreditFrequency,
    MonthlyCreditTiming,
};
use super::settings::Mp2DividendRates;

const MONTHS_PER_YEAR: u32 = 12;

/// Pag-IBIG weights each contribution by the months left in the year, counting the
/// month it was made: January earns 12/12, April 9/12, December 1/12.
fn month_weight(month: u32) -> Decimal {
    Decimal::from(MONTHS_PER_YEAR + 1 - month) / Decimal::from(MONTHS_PER_YEAR)
}

/// Dividends and the withdrawal that pays them out are not contributions — they
/// never earn in the year they are credited.
fn is_contribution(event: &CashLedgerEvent, interest_dates: &HashSet<NaiveDate>) -> bool {
    if event.is_interest() || event.is_auto_generated() {
        return false;
    }
    !(event.is_withdrawal() && interest_dates.contains(&event.date))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlannedKind {
    Interest,
    Payout,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedActivity {
    pub date: NaiveDate,
    /// Gross interest, before withholding.
    pub amount: Decimal,
    /// Withholding deducted from `amount`; zero when the product is untaxed.
    pub tax: Decimal,
    pub kind: PlannedKind,
    pub idempotency_key: String,
    /// Rate the amount was derived from, recorded for auditability.
    pub rate: Decimal,
    /// True when the year's rate has not been declared yet and `apy` was assumed.
    pub estimated: bool,
}

impl PlannedActivity {
    /// Cash that actually settles, which is what a compounding balance grows by.
    pub fn net(&self) -> Decimal {
        self.amount - self.tax
    }
}

/// An existing auto-generated row whose amount no longer matches the current rates.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedAmendment {
    pub activity_id: String,
    pub previous_amount: Decimal,
    pub previous_tax: Decimal,
    pub planned: PlannedActivity,
}

/// An auto row superseded by a manual entry on the same date.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedRemoval {
    pub activity_id: String,
    /// Cash this row was contributing, so callers can report the net effect.
    pub cash_delta: Decimal,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct InterestPlan {
    pub creates: Vec<PlannedActivity>,
    pub amendments: Vec<PlannedAmendment>,
    pub removals: Vec<PlannedRemoval>,
}

impl InterestPlan {
    pub fn is_empty(&self) -> bool {
        self.creates.is_empty() && self.amendments.is_empty() && self.removals.is_empty()
    }
}

fn is_month_end(date: NaiveDate) -> bool {
    date.succ_opt()
        .map_or(true, |next| next.month() != date.month())
}

/// Whether the product's schedule credits interest on `date`.
fn is_credit_date(
    date: NaiveDate,
    month_weighted: bool,
    frequency: CreditFrequency,
    monthly_timing: MonthlyCreditTiming,
) -> bool {
    if month_weighted {
        return is_year_end(date);
    }
    match frequency {
        CreditFrequency::Daily => true,
        CreditFrequency::Monthly => match monthly_timing {
            MonthlyCreditTiming::MonthEnd => is_month_end(date),
            MonthlyCreditTiming::NextMonthStart => date.day() == 1,
        },
        CreditFrequency::Yearly => is_year_end(date),
    }
}

/// Interest earned in one day on `closing_cash`, the balance the account holds at
/// the end of that day. `basis` is the day-count denominator (360 or 365), and
/// `minimum_balance` is the threshold the account must reach to earn at all.
pub fn daily_interest(
    closing_cash: Decimal,
    apy: Decimal,
    basis: i64,
    minimum_balance: Decimal,
) -> Decimal {
    if closing_cash <= Decimal::ZERO || apy <= Decimal::ZERO || closing_cash < minimum_balance {
        return Decimal::ZERO;
    }
    (closing_cash * apy) / Decimal::from(basis)
}

pub fn round_money(amount: Decimal) -> Decimal {
    amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

struct PostContext<'a> {
    account_id: &'a str,
    compounding: bool,
    withholding_tax_rate: Decimal,
    today: NaiveDate,
    /// Auto rows we may correct in place, keyed by idempotency key -> (id, amount, tax).
    existing_auto: HashMap<String, (String, Decimal, Decimal)>,
    /// Dates carrying a manual or user-edited interest row, which we never touch.
    override_dates: HashSet<NaiveDate>,
}

#[derive(Default)]
struct PlanAccumulator {
    running: Decimal,
    plan: InterestPlan,
}

impl PlanAccumulator {
    fn with_removals(removals: Vec<PlannedRemoval>) -> Self {
        Self {
            plan: InterestPlan {
                removals,
                ..InterestPlan::default()
            },
            ..Self::default()
        }
    }
}

pub fn plan_interest(
    account_id: &str,
    product: &CashProduct,
    rates: &Mp2DividendRates,
    events: &[CashLedgerEvent],
    today: NaiveDate,
) -> InterestPlan {
    let Some(yield_cfg) = product.yield_config.as_ref() else {
        return InterestPlan::default();
    };
    if !yield_cfg.enabled || (yield_cfg.apy <= Decimal::ZERO && rates.is_empty()) {
        return InterestPlan::default();
    }

    let mut events: Vec<&CashLedgerEvent> = events.iter().collect();
    events.sort_by_key(|e| e.date);
    let first_event = events.first().map(|e| e.date);
    let start = yield_start_date(product).or(first_event);
    let Some(start) = start else {
        return InterestPlan::default();
    };
    if start > today {
        return InterestPlan::default();
    }

    let override_dates: HashSet<NaiveDate> = events
        .iter()
        .filter(|e| e.is_interest_override())
        .map(|e| e.date)
        .collect();

    // MP2 dividends are not daily accruals: Pag-IBIG applies the declared rate to the
    // opening balance plus month-weighted contributions, credited every December 31.
    let month_weighted = product.product_type == CashProductType::PagibigMp2;

    // An auto row goes stale two ways: a manual entry takes over its date, or the
    // credit schedule moves and no longer posts on that date at all. Retract both
    // before the walk so later balances never compound on withdrawn cash.
    let removals: Vec<PlannedRemoval> = events
        .iter()
        .filter(|e| {
            e.is_amendable()
                && (override_dates.contains(&e.date)
                    || !is_credit_date(
                        e.date,
                        month_weighted,
                        yield_cfg.credit_frequency,
                        yield_cfg.monthly_credit_timing,
                    ))
        })
        .map(|e| PlannedRemoval {
            activity_id: e.id.clone(),
            cash_delta: e.signed_cash_delta(),
        })
        .collect();
    let removed_ids: HashSet<String> = removals.iter().map(|r| r.activity_id.clone()).collect();

    let ctx = PostContext {
        account_id,
        compounding: product.compounding,
        withholding_tax_rate: yield_cfg.withholding_tax_rate.max(Decimal::ZERO),
        today,
        existing_auto: events
            .iter()
            .filter(|e| e.is_amendable() && !removed_ids.contains(e.id.as_str()))
            .filter_map(|e| {
                e.idempotency_key
                    .as_deref()
                    .map(|k| (k.to_string(), (e.id.clone(), e.amount, e.tax)))
            })
            .collect(),
        override_dates,
    };

    let interest_dates: HashSet<NaiveDate> = events
        .iter()
        .filter(|e| e.is_interest())
        .map(|e| e.date)
        .collect();

    let minimum_balance = yield_cfg.minimum_balance;
    let walk_from = first_event.map(|d| d.min(start)).unwrap_or(start);
    let mut acc = PlanAccumulator::with_removals(removals);
    let mut event_idx = 0;
    let mut month_accum = Decimal::ZERO;
    let mut year_accum = Decimal::ZERO;
    let mut year_opening = Decimal::ZERO;
    let mut weighted_contributions = Decimal::ZERO;
    let mut day = walk_from;

    while day <= today {
        if day.month() == 1 && day.day() == 1 {
            year_opening = acc.running;
            weighted_contributions = Decimal::ZERO;
        }

        while event_idx < events.len() && events[event_idx].date == day {
            let event = events[event_idx];
            // Rows queued for removal must not prop up the balance the later years compound on.
            if !removed_ids.contains(event.id.as_str()) {
                acc.running += event.signed_cash_delta();
                if month_weighted && is_contribution(event, &interest_dates) {
                    weighted_contributions += event.signed_cash_delta() * month_weight(day.month());
                }
            }
            event_idx += 1;
        }

        if day >= start {
            let year = day.year();
            // Declared rates belong to Pag-IBIG's MP2 program and are announced in
            // arrears. Every other product earns the rate configured on the account.
            let (rate, estimated) = if month_weighted {
                (
                    rates.rate_for_year(year, yield_cfg.apy),
                    !rates.is_declared(year),
                )
            } else {
                (yield_cfg.apy, false)
            };

            if month_weighted {
                if is_year_end(day) {
                    let base = year_opening + weighted_contributions;
                    try_post(&ctx, &mut acc, day, base * rate, rate, estimated);
                }
            } else {
                if yield_cfg.credit_frequency == CreditFrequency::Monthly
                    && yield_cfg.monthly_credit_timing == MonthlyCreditTiming::NextMonthStart
                    && day.day() == 1
                    && month_accum > Decimal::ZERO
                {
                    try_post(&ctx, &mut acc, day, month_accum, rate, estimated);
                    month_accum = Decimal::ZERO;
                }

                // Interest is earned on the day's closing balance, so a deposit
                // earns from the day it lands rather than the day after.
                let daily = daily_interest(
                    acc.running,
                    rate,
                    yield_cfg.day_count_basis(day),
                    minimum_balance,
                );
                match yield_cfg.credit_frequency {
                    CreditFrequency::Daily => {
                        try_post(&ctx, &mut acc, day, daily, rate, estimated);
                    }
                    CreditFrequency::Monthly => {
                        month_accum += daily;
                        if yield_cfg.monthly_credit_timing == MonthlyCreditTiming::MonthEnd
                            && is_month_end(day)
                        {
                            try_post(&ctx, &mut acc, day, month_accum, rate, estimated);
                            month_accum = Decimal::ZERO;
                        }
                    }
                    CreditFrequency::Yearly => {
                        year_accum += daily;
                        if is_year_end(day) {
                            try_post(&ctx, &mut acc, day, year_accum, rate, estimated);
                            year_accum = Decimal::ZERO;
                        }
                    }
                }
            }
        }

        day = match day.succ_opt() {
            Some(next) => next,
            None => break,
        };
    }

    acc.plan
}

fn try_post(
    ctx: &PostContext<'_>,
    acc: &mut PlanAccumulator,
    date: NaiveDate,
    amount: Decimal,
    rate: Decimal,
    estimated: bool,
) {
    if date > ctx.today {
        return;
    }
    let rounded = round_money(amount);
    if rounded <= Decimal::ZERO {
        return;
    }
    if ctx.override_dates.contains(&date) {
        return;
    }
    let ymd = date.format("%Y-%m-%d").to_string();
    let tax = round_money(rounded * ctx.withholding_tax_rate);

    let interest = PlannedActivity {
        date,
        amount: rounded,
        tax,
        kind: PlannedKind::Interest,
        idempotency_key: build_idempotency_key(ctx.account_id, &ymd),
        rate,
        estimated,
    };
    // Interest raises the balance, so the running total moves by the delta we apply.
    reconcile(ctx, acc, interest, |delta| delta);

    if !ctx.compounding {
        // Only the cash that actually settled can be paid out.
        let payout = PlannedActivity {
            date,
            amount: rounded - tax,
            tax: Decimal::ZERO,
            kind: PlannedKind::Payout,
            idempotency_key: build_payout_idempotency_key(ctx.account_id, &ymd),
            rate,
            estimated,
        };
        reconcile(ctx, acc, payout, |delta| -delta);
    }
}

/// Records `planned` as either a creation or an amendment of the matching auto row,
/// advancing the running balance by the change. Rows already in the ledger have been
/// applied by the event walk, so only the difference is applied here.
fn reconcile(
    ctx: &PostContext<'_>,
    acc: &mut PlanAccumulator,
    planned: PlannedActivity,
    sign: fn(Decimal) -> Decimal,
) {
    match ctx.existing_auto.get(&planned.idempotency_key) {
        Some((id, previous_amount, previous_tax)) => {
            if *previous_amount == planned.amount && *previous_tax == planned.tax {
                return;
            }
            acc.running += sign(planned.net() - (previous_amount - previous_tax));
            acc.plan.amendments.push(PlannedAmendment {
                activity_id: id.clone(),
                previous_amount: *previous_amount,
                previous_tax: *previous_tax,
                planned,
            });
        }
        None => {
            acc.running += sign(planned.net());
            acc.plan.creates.push(planned);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::product::{
        CashProductType, YieldConfig, DAY_COUNT_ACTUAL_360, DAY_COUNT_ACTUAL_ACTUAL,
    };
    use super::*;
    use crate::activities::ACTIVITY_TYPE_DEPOSIT;
    use rust_decimal_macros::dec;

    /// A product paired with the app-wide rate table it should be planned against.
    struct Setup {
        product: CashProduct,
        rates: Mp2DividendRates,
    }

    fn plan(
        account_id: &str,
        setup: &Setup,
        events: &[CashLedgerEvent],
        today: NaiveDate,
    ) -> InterestPlan {
        plan_interest(account_id, &setup.product, &setup.rates, events, today)
    }

    fn hysa(freq: CreditFrequency, compounding: bool) -> Setup {
        Setup {
            product: CashProduct {
                product_type: CashProductType::Hysa,
                compounding,
                yield_config: Some(YieldConfig {
                    enabled: true,
                    apy: dec!(0.365),
                    credit_frequency: freq,
                    monthly_credit_timing: MonthlyCreditTiming::NextMonthStart,
                    withholding_tax_rate: Decimal::ZERO,
                    minimum_balance: Decimal::ZERO,
                    day_count: Some("actual_365".into()),
                    start_date: Some("2024-01-01".into()),
                }),
                target_amount: None,
                first_contribution_date: Some("2024-01-01".into()),
                maturity_date: None,
                mp2_account_number: None,
            },
            rates: Mp2DividendRates::default(),
        }
    }

    fn deposit(date: &str, amount: Decimal) -> CashLedgerEvent {
        CashLedgerEvent {
            id: format!("dep-{date}"),
            date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            activity_type: ACTIVITY_TYPE_DEPOSIT.to_string(),
            amount,
            fee: Decimal::ZERO,
            tax: Decimal::ZERO,
            source_system: None,
            idempotency_key: None,
            is_user_modified: false,
        }
    }

    fn auto_interest(id: &str, date: &str, amount: Decimal) -> CashLedgerEvent {
        CashLedgerEvent {
            id: id.into(),
            date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            activity_type: crate::activities::ACTIVITY_TYPE_INTEREST.to_string(),
            amount,
            fee: Decimal::ZERO,
            tax: Decimal::ZERO,
            source_system: Some(crate::interest::SOURCE_SYSTEM.into()),
            idempotency_key: Some(format!("cash-int:acc:{date}")),
            is_user_modified: false,
        }
    }

    fn removed_ids(plan: &InterestPlan) -> Vec<&str> {
        plan.removals
            .iter()
            .map(|r| r.activity_id.as_str())
            .collect()
    }

    fn mp2(apy: Decimal, declared: &[(&str, Decimal)]) -> Setup {
        let mut rates = Mp2DividendRates::default();
        for (year, rate) in declared {
            rates.rates.insert((*year).to_string(), *rate);
        }
        Setup {
            product: CashProduct {
                product_type: CashProductType::PagibigMp2,
                compounding: true,
                yield_config: Some(YieldConfig {
                    enabled: true,
                    apy,
                    credit_frequency: CreditFrequency::Yearly,
                    monthly_credit_timing: MonthlyCreditTiming::NextMonthStart,
                    withholding_tax_rate: Decimal::ZERO,
                    minimum_balance: Decimal::ZERO,
                    day_count: Some("actual_365".into()),
                    start_date: Some("2024-01-01".into()),
                }),
                target_amount: None,
                first_contribution_date: Some("2024-01-01".into()),
                maturity_date: None,
                mp2_account_number: None,
            },
            rates,
        }
    }

    #[test]
    fn daily_uses_closing_balance_so_a_deposit_earns_the_day_it_lands() {
        let events = vec![deposit("2024-01-01", dec!(1000))];
        let planned = plan(
            "acc",
            &hysa(CreditFrequency::Daily, true),
            &events,
            NaiveDate::from_ymd_opt(2024, 1, 2).unwrap(),
        );
        let interest: Vec<_> = planned
            .creates
            .into_iter()
            .filter(|p| p.kind == PlannedKind::Interest)
            .collect();
        assert_eq!(interest.len(), 2);
        assert_eq!(
            interest[0].date,
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap()
        );
        assert_eq!(interest[0].amount, dec!(1.00));
    }

    #[test]
    fn a_day_below_the_minimum_balance_earns_nothing() {
        let mut setup = hysa(CreditFrequency::Daily, true);
        if let Some(y) = setup.product.yield_config.as_mut() {
            y.minimum_balance = dec!(5000);
        }
        let events = vec![
            deposit("2024-01-01", dec!(1000)),
            deposit("2024-01-03", dec!(9000)),
        ];
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 1, 3).unwrap(),
        );
        // Jan 1-2 sit at 1,000 and earn nothing; Jan 3 clears the threshold.
        assert_eq!(planned.creates.len(), 1);
        assert_eq!(
            planned.creates[0].date,
            NaiveDate::from_ymd_opt(2024, 1, 3).unwrap()
        );
    }

    #[test]
    fn an_actual_360_basis_pays_more_than_365_for_the_same_rate() {
        let events = vec![deposit("2024-01-01", dec!(100000))];
        let mut setup = hysa(CreditFrequency::Daily, false);
        if let Some(y) = setup.product.yield_config.as_mut() {
            y.apy = dec!(0.05);
            y.day_count = Some(DAY_COUNT_ACTUAL_360.into());
        }
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        );
        // 100,000 x 5% / 360 = 13.888..., against 13.70 on a 365 basis.
        assert_eq!(planned.creates[0].amount, dec!(13.89));
    }

    #[test]
    fn actual_actual_uses_366_days_in_a_leap_year() {
        let events = vec![deposit("2024-02-29", dec!(100000))];
        let mut setup = hysa(CreditFrequency::Daily, false);
        if let Some(y) = setup.product.yield_config.as_mut() {
            y.apy = dec!(0.05);
            y.day_count = Some(DAY_COUNT_ACTUAL_ACTUAL.into());
        }
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 29).unwrap(),
        );

        assert_eq!(planned.creates[0].amount, dec!(13.66));
    }

    /// Mirrors a real BanKo statement: 5% on an actual/360 basis, 20% withholding,
    /// credited on the first of the next month, compounding.
    #[test]
    fn matches_a_philippine_hysa_statement() {
        let mut setup = hysa(CreditFrequency::Monthly, true);
        if let Some(y) = setup.product.yield_config.as_mut() {
            y.apy = dec!(0.05);
            y.withholding_tax_rate = dec!(0.20);
            y.minimum_balance = dec!(5000);
            y.day_count = Some(DAY_COUNT_ACTUAL_360.into());
            y.start_date = Some("2025-05-05".into());
        }
        setup.product.first_contribution_date = Some("2024-03-09".into());

        let mut events = vec![deposit("2024-03-09", dec!(500))];
        for (idx, (date, amount)) in [
            ("2025-05-05", dec!(49500)),
            ("2025-05-08", dec!(50000)),
            ("2025-05-14", dec!(48000)),
            ("2025-05-15", dec!(2000)),
            ("2025-05-30", dec!(50000)),
            ("2025-06-16", dec!(50000)),
            ("2025-06-30", dec!(50000)),
        ]
        .into_iter()
        .enumerate()
        {
            events.push(CashLedgerEvent {
                id: format!("d{idx}"),
                ..deposit(date, amount)
            });
        }

        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2025, 7, 1).unwrap(),
        );
        let may = &planned.creates[0];
        assert_eq!(may.date, NaiveDate::from_ymd_opt(2025, 6, 1).unwrap());
        assert_eq!(may.amount, dec!(492.78));
        assert_eq!(may.tax, dec!(98.56));
        assert_eq!(may.net(), dec!(394.22));

        // June compounds on May's net credit from June 1.
        let june = &planned.creates[1];
        assert_eq!(june.date, NaiveDate::from_ymd_opt(2025, 7, 1).unwrap());
        assert_eq!(june.amount, dec!(946.09));
        assert_eq!(june.net(), dec!(756.87));
    }

    #[test]
    fn monthly_credits_on_the_first_of_the_next_month() {
        let events = vec![deposit("2024-01-01", dec!(1000))];
        let planned = plan(
            "acc",
            &hysa(CreditFrequency::Monthly, true),
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 5).unwrap(),
        );
        let interest: Vec<_> = planned
            .creates
            .into_iter()
            .filter(|p| p.kind == PlannedKind::Interest)
            .collect();
        // January's interest lands on Feb 1; February's is not due until Mar 1.
        assert_eq!(interest.len(), 1);
        assert_eq!(
            interest[0].date,
            NaiveDate::from_ymd_opt(2024, 2, 1).unwrap()
        );
        // 31 earning days: the Jan 1 deposit earns from Jan 1.
        assert_eq!(interest[0].amount, dec!(31.00));
    }

    #[test]
    fn monthly_interest_can_credit_on_the_last_day_of_the_month() {
        let mut setup = hysa(CreditFrequency::Monthly, true);
        if let Some(y) = setup.product.yield_config.as_mut() {
            y.monthly_credit_timing = MonthlyCreditTiming::MonthEnd;
        }
        let events = vec![deposit("2024-01-01", dec!(1000))];
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
        );

        assert_eq!(planned.creates.len(), 1);
        assert_eq!(
            planned.creates[0].date,
            NaiveDate::from_ymd_opt(2024, 1, 31).unwrap()
        );
        assert_eq!(planned.creates[0].amount, dec!(31.00));
    }

    #[test]
    fn a_credit_does_not_earn_interest_on_the_day_it_lands() {
        let events = vec![deposit("2024-01-01", dec!(1000))];
        let planned = plan(
            "acc",
            &hysa(CreditFrequency::Daily, true),
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 2).unwrap(),
        );
        let feb_credit = planned
            .creates
            .iter()
            .find(|p| p.date == NaiveDate::from_ymd_opt(2024, 2, 1).unwrap())
            .expect("Feb 1 credit");
        // Daily compounding: Feb 1 earns on the balance built through Jan 31 only.
        assert!(feb_credit.amount > dec!(1.00));
    }

    #[test]
    fn yearly_compound_posts_on_dec_31() {
        let events = vec![deposit("2024-01-01", dec!(1000))];
        let setup = mp2(dec!(0.365), &[]);
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
        );
        let interest: Vec<_> = planned
            .creates
            .iter()
            .filter(|p| p.kind == PlannedKind::Interest)
            .collect();
        assert_eq!(interest.len(), 1);
        assert_eq!(
            interest[0].date,
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap()
        );
        assert!(planned
            .creates
            .iter()
            .all(|p| p.kind != PlannedKind::Payout));
        // 365 days * 1.00 but Jan 1 doesn't earn, and compounding daily internally in accum
        // accum is simple sum of daily on SOD without adding generated interest until post.
        // For yearly compounding=true, we only add to running on Dec 31, so intra-year SOD
        // does not include accrued interest. That's correct for MP2 (annual credit).
        assert_eq!(interest[0].amount, dec!(365.00)); // 365 days Jan 2-Dec 31? 365 days in 2024 leap?
                                                      // 2024 is leap. Jan 1 deposit, earn Jan 2 through Dec 31 = 365 days (2024 has 366 days, minus Jan 1).
                                                      // 366 - 1 = 365. Yes.
    }

    #[test]
    fn yearly_annual_payout_adds_withdrawal() {
        let events = vec![deposit("2024-01-01", dec!(1000))];
        let mut setup = mp2(dec!(0.365), &[]);
        setup.product.compounding = false;
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
        );
        assert_eq!(planned.creates.len(), 2);
        assert_eq!(planned.creates[0].kind, PlannedKind::Interest);
        assert_eq!(planned.creates[1].kind, PlannedKind::Payout);
        assert_eq!(planned.creates[0].amount, planned.creates[1].amount);
        assert_eq!(planned.creates[0].date, planned.creates[1].date);
    }

    #[test]
    fn override_skips_credit_date() {
        let mut events = vec![deposit("2024-01-01", dec!(1000))];
        events.push(CashLedgerEvent {
            id: "manual-1".into(),
            date: NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
            activity_type: crate::activities::ACTIVITY_TYPE_INTEREST.to_string(),
            amount: dec!(12.34),
            fee: Decimal::ZERO,
            tax: Decimal::ZERO,
            source_system: Some("MANUAL".into()),
            idempotency_key: None,
            is_user_modified: false,
        });
        let planned = plan(
            "acc",
            &hysa(CreditFrequency::Monthly, true),
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 5).unwrap(),
        );
        assert!(planned.is_empty());
    }

    #[test]
    fn existing_auto_row_with_matching_amount_is_left_alone() {
        let mut events = vec![deposit("2024-01-01", dec!(1000))];
        events.push(auto_interest("auto-1", "2024-01-01", dec!(1)));
        let planned = plan(
            "acc",
            &hysa(CreditFrequency::Daily, true),
            &events,
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
        );
        assert!(planned.is_empty());
    }

    #[test]
    fn undeclared_year_accrues_at_assumed_rate_and_is_flagged_estimated() {
        let events = vec![deposit("2024-01-01", dec!(100000))];
        let planned = plan(
            "acc",
            &mp2(dec!(0.0712), &[]),
            &events,
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
        );
        assert_eq!(planned.creates.len(), 1);
        let row = &planned.creates[0];
        assert!(row.estimated);
        assert_eq!(row.rate, dec!(0.0712));
        assert!(planned.amendments.is_empty());
    }

    #[test]
    fn declared_rate_amends_the_earlier_estimate() {
        // Dec 2024 was posted at the assumed 7.12%; Pag-IBIG later declares 7.05%.
        let events = vec![
            deposit("2024-01-01", dec!(100000)),
            auto_interest("auto-2024", "2024-12-31", dec!(7120.00)),
        ];
        let planned = plan(
            "acc",
            &mp2(dec!(0.0712), &[("2024", dec!(0.0705))]),
            &events,
            NaiveDate::from_ymd_opt(2025, 3, 20).unwrap(),
        );
        assert_eq!(planned.creates.len(), 0);
        assert_eq!(planned.amendments.len(), 1);
        let amendment = &planned.amendments[0];
        assert_eq!(amendment.activity_id, "auto-2024");
        assert_eq!(amendment.previous_amount, dec!(7120.00));
        assert_eq!(amendment.planned.rate, dec!(0.0705));
        assert!(!amendment.planned.estimated);
        assert!(amendment.planned.amount < dec!(7120.00));
    }

    #[test]
    fn correcting_an_early_year_reflows_later_years() {
        let events = vec![
            deposit("2024-01-01", dec!(100000)),
            auto_interest("auto-2024", "2024-12-31", dec!(7120.00)),
            auto_interest("auto-2025", "2025-12-31", dec!(7626.94)),
        ];
        let planned = plan(
            "acc",
            &mp2(dec!(0.0712), &[("2024", dec!(0.0600))]),
            &events,
            NaiveDate::from_ymd_opt(2025, 12, 31).unwrap(),
        );
        // Both the corrected year and the year that compounded on top of it change.
        let ids: Vec<&str> = planned
            .amendments
            .iter()
            .map(|a| a.activity_id.as_str())
            .collect();
        assert!(ids.contains(&"auto-2024"));
        assert!(ids.contains(&"auto-2025"));
        let y2025 = planned
            .amendments
            .iter()
            .find(|a| a.activity_id == "auto-2025")
            .unwrap();
        // 2025 still has no declared rate, so it stays an estimate at the assumed APY.
        assert!(y2025.planned.estimated);
        assert_eq!(y2025.planned.rate, dec!(0.0712));
        assert!(y2025.planned.amount < dec!(7626.94));
    }

    #[test]
    fn mp2_uses_pagibig_month_weighted_formula() {
        // ₱650k in January (12/12) + ₱50k in April (9/12) = ₱687,500 weighted base.
        // At the declared 2024 rate of 7.10% that is exactly ₱48,812.50.
        let events = vec![
            deposit("2024-01-02", dec!(650000)),
            deposit("2024-04-16", dec!(50000)),
        ];
        let planned = plan(
            "acc",
            &mp2(dec!(0.0712), &[("2024", dec!(0.0710))]),
            &events,
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
        );
        assert_eq!(planned.creates.len(), 1);
        assert_eq!(planned.creates[0].amount, dec!(48812.50));
        assert!(!planned.creates[0].estimated);
    }

    #[test]
    fn mp2_opening_balance_earns_a_full_year() {
        // 2024 dividend compounds, so 2025 opens at 650k + 50k + 48,812.50 and the
        // January 2025 contribution earns 12/12 on top of it.
        let events = vec![
            deposit("2024-01-02", dec!(650000)),
            deposit("2024-04-16", dec!(50000)),
            deposit("2025-01-03", dec!(500000)),
        ];
        let planned = plan(
            "acc",
            &mp2(dec!(0.0712), &[("2024", dec!(0.0710))]),
            &events,
            NaiveDate::from_ymd_opt(2025, 12, 31).unwrap(),
        );
        let y2025 = planned
            .creates
            .iter()
            .find(|p| p.date == NaiveDate::from_ymd_opt(2025, 12, 31).unwrap())
            .expect("2025 dividend");
        // (748,812.50 opening + 500,000 January) x 7.12% assumed
        assert_eq!(y2025.amount, dec!(88915.45));
        assert!(y2025.estimated);
    }

    #[test]
    fn mp2_weights_a_december_contribution_at_one_twelfth() {
        let events = vec![deposit("2024-12-05", dec!(120000))];
        let planned = plan(
            "acc",
            &mp2(dec!(0.10), &[("2024", dec!(0.10))]),
            &events,
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
        );
        // 120,000 x 1/12 x 10% = 1,000
        assert_eq!(planned.creates[0].amount, dec!(1000.00));
    }

    #[test]
    fn manual_dividend_retracts_an_estimate_already_posted_on_that_date() {
        // The estimate was generated first, then the real dividend was recorded by hand.
        let manual = CashLedgerEvent {
            id: "manual-2024".into(),
            date: NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
            activity_type: crate::activities::ACTIVITY_TYPE_INTEREST.to_string(),
            amount: dec!(48812.50),
            fee: Decimal::ZERO,
            tax: Decimal::ZERO,
            source_system: None,
            idempotency_key: None,
            is_user_modified: false,
        };
        let events = vec![
            deposit("2024-01-02", dec!(650000)),
            auto_interest("auto-2024", "2024-12-31", dec!(48688.26)),
            manual,
        ];
        let planned = plan(
            "acc",
            &mp2(dec!(0.0712), &[]),
            &events,
            NaiveDate::from_ymd_opt(2025, 6, 30).unwrap(),
        );
        assert_eq!(removed_ids(&planned), vec!["auto-2024"]);
        assert_eq!(planned.removals[0].cash_delta, dec!(48688.26));
        // The date now belongs to the manual figure alone.
        assert!(planned
            .creates
            .iter()
            .all(|p| p.date != NaiveDate::from_ymd_opt(2024, 12, 31).unwrap()));
        assert!(planned
            .amendments
            .iter()
            .all(|a| a.activity_id != "auto-2024"));
    }

    #[test]
    fn retracted_estimate_does_not_inflate_later_years() {
        let manual = CashLedgerEvent {
            id: "manual-2024".into(),
            date: NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
            activity_type: crate::activities::ACTIVITY_TYPE_INTEREST.to_string(),
            amount: dec!(48812.50),
            fee: Decimal::ZERO,
            tax: Decimal::ZERO,
            source_system: None,
            idempotency_key: None,
            is_user_modified: false,
        };
        let events = vec![
            deposit("2024-01-02", dec!(650000)),
            auto_interest("auto-2024", "2024-12-31", dec!(48688.26)),
            manual,
            auto_interest("auto-2025", "2025-12-31", dec!(53250.00)),
        ];
        let planned = plan(
            "acc",
            &mp2(dec!(0.0712), &[]),
            &events,
            NaiveDate::from_ymd_opt(2025, 12, 31).unwrap(),
        );
        assert_eq!(removed_ids(&planned), vec!["auto-2024"]);
        // 2025 compounded on a balance that included the duplicate, so it must come down.
        let y2025 = planned
            .amendments
            .iter()
            .find(|a| a.activity_id == "auto-2025")
            .expect("2025 should be recomputed");
        assert!(y2025.planned.amount < dec!(53250.00));
    }

    #[test]
    fn declared_mp2_rates_do_not_leak_into_other_products() {
        // The MP2 rate table is app-wide; a savings account must still earn its own APY.
        let mut setup = hysa(CreditFrequency::Monthly, true);
        if let Some(y) = setup.product.yield_config.as_mut() {
            y.apy = dec!(0.05);
        }
        setup.rates.rates.insert("2024".into(), dec!(0.0712));

        let events = vec![deposit("2024-01-01", dec!(100000))];
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
        );
        let credit = &planned.creates[0];
        assert_eq!(credit.rate, dec!(0.05));
        assert!(!credit.estimated);
        // 31 days x 100,000 x 5% / 365
        assert_eq!(credit.amount, dec!(424.66));
    }

    #[test]
    fn withholding_is_recorded_and_only_the_net_compounds() {
        let mut setup = hysa(CreditFrequency::Monthly, true);
        if let Some(y) = setup.product.yield_config.as_mut() {
            y.apy = dec!(0.05);
            y.withholding_tax_rate = dec!(0.20);
        }
        let events = vec![deposit("2024-01-01", dec!(100000))];
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 3, 1).unwrap(),
        );
        let jan = &planned.creates[0];
        // Gross is booked on the activity; the tax field carries the deduction.
        assert_eq!(jan.amount, dec!(424.66));
        assert_eq!(jan.tax, dec!(84.93));
        assert_eq!(jan.net(), dec!(339.73));

        // February compounds on 100,000 + 339.73 net, not on the gross.
        let feb = &planned.creates[1];
        assert_eq!(feb.date, NaiveDate::from_ymd_opt(2024, 3, 1).unwrap());
        let daily = |balance: Decimal| balance * dec!(0.05) / Decimal::from(365);
        assert_eq!(
            feb.amount,
            round_money(daily(dec!(100339.73)) * Decimal::from(29))
        );
    }

    #[test]
    fn an_untaxed_product_records_no_withholding() {
        let events = vec![deposit("2024-01-01", dec!(1000))];
        let planned = plan(
            "acc",
            &hysa(CreditFrequency::Monthly, true),
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
        );
        assert_eq!(planned.creates[0].tax, Decimal::ZERO);
        assert_eq!(planned.creates[0].net(), dec!(31.00));
    }

    #[test]
    fn a_tax_rate_change_amends_existing_rows() {
        let mut setup = hysa(CreditFrequency::Monthly, true);
        if let Some(y) = setup.product.yield_config.as_mut() {
            y.apy = dec!(0.05);
            y.withholding_tax_rate = dec!(0.20);
        }
        // The row was generated before withholding was configured, so the gross
        // matches but the tax does not.
        let events = vec![
            deposit("2024-01-01", dec!(100000)),
            auto_interest("auto-jan", "2024-02-01", dec!(424.66)),
        ];
        let planned = plan(
            "acc",
            &setup,
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
        );
        assert_eq!(planned.amendments.len(), 1);
        let amendment = &planned.amendments[0];
        assert_eq!(amendment.activity_id, "auto-jan");
        assert_eq!(amendment.previous_tax, Decimal::ZERO);
        assert_eq!(amendment.planned.tax, dec!(84.93));
        assert_eq!(amendment.planned.amount, dec!(424.66));
    }

    #[test]
    fn month_end_rows_from_the_old_schedule_are_retracted() {
        // Interest used to post on the last day of the month. Those rows are no longer
        // on the schedule, so they must be withdrawn rather than left beside the new one.
        let events = vec![
            deposit("2024-01-01", dec!(1000)),
            auto_interest("stale-jan", "2024-01-31", dec!(31.00)),
        ];
        let planned = plan(
            "acc",
            &hysa(CreditFrequency::Monthly, true),
            &events,
            NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
        );
        assert_eq!(removed_ids(&planned), vec!["stale-jan"]);
        assert_eq!(planned.removals[0].cash_delta, dec!(31.00));
        let credit = &planned.creates[0];
        assert_eq!(credit.date, NaiveDate::from_ymd_opt(2024, 2, 1).unwrap());
        // The retracted row must not inflate the balance the new credit is drawn from.
        assert_eq!(credit.amount, dec!(31.00));
    }

    #[test]
    fn user_modified_auto_row_is_never_amended() {
        let mut edited = auto_interest("auto-2024", "2024-12-31", dec!(9999.00));
        edited.is_user_modified = true;
        let events = vec![deposit("2024-01-01", dec!(100000)), edited];
        let planned = plan(
            "acc",
            &mp2(dec!(0.0712), &[("2024", dec!(0.0705))]),
            &events,
            NaiveDate::from_ymd_opt(2025, 3, 20).unwrap(),
        );
        assert!(planned.amendments.is_empty());
        assert!(planned.creates.is_empty());
    }
}
