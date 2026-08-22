use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;

/// Minimum past payments needed before a cadence can be inferred.
const MIN_HISTORY: usize = 3;
/// Gaps outside this range are treated as noise (specials, data glitches).
const MIN_GAP_DAYS: i64 = 20;
const MAX_GAP_DAYS: i64 = 400;
/// Stop projecting once the payer looks lapsed.
const STALE_CADENCE_MULTIPLIER: i64 = 2;
const MAX_PROJECTIONS: usize = 6;
/// Amounts are smoothed over the most recent payments to blunt specials.
const AMOUNT_SAMPLE: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedDividend {
    pub ex_date: NaiveDate,
    pub per_share: Decimal,
}

/// Project future ex-dates from an asset's own payment cadence.
///
/// Returns nothing when history is too thin, irregular, or stale — a projection
/// is only useful when the payer has an obvious rhythm. Amounts reuse recent
/// per-share values, so these are estimates until the provider publishes the
/// real dividend.
pub fn project_future_dividends(
    history: &[(NaiveDate, Decimal)],
    today: NaiveDate,
    horizon: NaiveDate,
) -> Vec<ProjectedDividend> {
    let mut past: Vec<(NaiveDate, Decimal)> = history
        .iter()
        .filter(|(date, amount)| *date <= today && *amount > Decimal::ZERO)
        .copied()
        .collect();
    past.sort_by_key(|(date, _)| *date);
    past.dedup_by_key(|(date, _)| *date);

    if past.len() < MIN_HISTORY {
        return Vec::new();
    }

    let Some(cadence) = median_gap_days(&past) else {
        return Vec::new();
    };

    let last_date = past.last().map(|(date, _)| *date).unwrap_or(today);
    if (today - last_date).num_days() > cadence * STALE_CADENCE_MULTIPLIER {
        return Vec::new();
    }

    let per_share = smoothed_amount(&past);
    if per_share <= Decimal::ZERO {
        return Vec::new();
    }

    let mut projections = Vec::new();
    let mut next = last_date + Duration::days(cadence);
    while next <= horizon && projections.len() < MAX_PROJECTIONS {
        if next > today {
            projections.push(ProjectedDividend {
                ex_date: next,
                per_share,
            });
        }
        next += Duration::days(cadence);
    }

    projections
}

fn median_gap_days(past: &[(NaiveDate, Decimal)]) -> Option<i64> {
    let mut gaps: Vec<i64> = past
        .windows(2)
        .map(|pair| (pair[1].0 - pair[0].0).num_days())
        .filter(|gap| (MIN_GAP_DAYS..=MAX_GAP_DAYS).contains(gap))
        .collect();

    if gaps.len() < 2 {
        return None;
    }

    gaps.sort_unstable();
    Some(gaps[gaps.len() / 2])
}

fn smoothed_amount(past: &[(NaiveDate, Decimal)]) -> Decimal {
    let start = past.len().saturating_sub(AMOUNT_SAMPLE);
    let mut amounts: Vec<Decimal> = past[start..].iter().map(|(_, amount)| *amount).collect();
    amounts.sort();
    amounts.get(amounts.len() / 2).copied().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn projects_quarterly_cadence_within_horizon() {
        let history = vec![
            (date(2025, 8, 20), dec!(1.5)),
            (date(2025, 11, 20), dec!(1.5)),
            (date(2026, 2, 20), dec!(1.5)),
            (date(2026, 5, 20), dec!(1.5)),
        ];

        let projected = project_future_dividends(&history, date(2026, 8, 16), date(2027, 8, 16));

        assert_eq!(projected.len(), 4);
        assert!(projected.iter().all(|p| p.per_share == dec!(1.5)));
        assert!(projected[0].ex_date > date(2026, 8, 16));
        let gap = (projected[1].ex_date - projected[0].ex_date).num_days();
        assert!((89..=93).contains(&gap), "unexpected cadence gap: {gap}");
    }

    #[test]
    fn ignores_thin_history() {
        let history = vec![
            (date(2026, 2, 20), dec!(1.0)),
            (date(2026, 5, 20), dec!(1.0)),
        ];

        assert!(
            project_future_dividends(&history, date(2026, 8, 16), date(2027, 8, 16)).is_empty()
        );
    }

    #[test]
    fn ignores_lapsed_payer() {
        let history = vec![
            (date(2022, 2, 20), dec!(1.0)),
            (date(2022, 5, 20), dec!(1.0)),
            (date(2022, 8, 20), dec!(1.0)),
        ];

        assert!(
            project_future_dividends(&history, date(2026, 8, 16), date(2027, 8, 16)).is_empty()
        );
    }

    #[test]
    fn smooths_special_dividend_amounts() {
        let history = vec![
            (date(2025, 8, 20), dec!(1.0)),
            (date(2025, 11, 20), dec!(1.0)),
            (date(2026, 2, 20), dec!(9.0)),
            (date(2026, 5, 20), dec!(1.0)),
        ];

        let projected = project_future_dividends(&history, date(2026, 8, 16), date(2026, 12, 31));

        assert!(!projected.is_empty());
        assert_eq!(projected[0].per_share, dec!(1.0));
    }
}
