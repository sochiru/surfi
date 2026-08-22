//! Pag-IBIG declares one MP2 dividend rate per year for every member, so the rate
//! table is an app-wide setting rather than something configured per account.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const SETTINGS_KEY: &str = "mp2_dividend_rates";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mp2DividendRates {
    /// Declared rates keyed by the calendar year they were earned in. Pag-IBIG
    /// announces around March of the following year, so the most recent year is
    /// normally absent and falls back to the account's assumed rate.
    #[serde(default)]
    pub rates: BTreeMap<String, Decimal>,
}

impl Mp2DividendRates {
    pub fn declared(&self, year: i32) -> Option<Decimal> {
        self.rates.get(&year.to_string()).copied()
    }

    pub fn is_declared(&self, year: i32) -> bool {
        self.declared(year).is_some()
    }

    pub fn rate_for_year(&self, year: i32, assumed: Decimal) -> Decimal {
        self.declared(year).unwrap_or(assumed)
    }

    pub fn is_empty(&self) -> bool {
        self.rates.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn declared_rate_wins_over_the_assumed_one() {
        let raw = r#"{"rates":{"2023":0.0705,"2024":0.0710}}"#;
        let rates: Mp2DividendRates = serde_json::from_str(raw).unwrap();
        assert_eq!(rates.rate_for_year(2024, dec!(0.0712)), dec!(0.0710));
        assert!(rates.is_declared(2024));
        assert_eq!(rates.rate_for_year(2025, dec!(0.0712)), dec!(0.0712));
        assert!(!rates.is_declared(2025));
    }

    #[test]
    fn empty_table_always_falls_back() {
        let rates = Mp2DividendRates::default();
        assert!(rates.is_empty());
        assert_eq!(rates.rate_for_year(2024, dec!(0.06)), dec!(0.06));
    }
}
