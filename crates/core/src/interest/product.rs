//! Cash-product metadata on CASH accounts (HYSA, goal pots, Pag-IBIG MP2).

use chrono::{Datelike, Months, NaiveDate};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::accounts::Account;

pub const CASH_CATEGORY_FIXED_INCOME: &str = "FIXED_INCOME";
pub const MP2_GROUP: &str = "Pag-IBIG";
pub const MP2_TERM_YEARS: u32 = 5;
pub const DAY_COUNT_ACTUAL_360: &str = "actual_360";
pub const DAY_COUNT_ACTUAL_ACTUAL: &str = "actual_actual";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CashProductType {
    Hysa,
    HysaGoal,
    PagibigMp2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CreditFrequency {
    #[default]
    Daily,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MonthlyCreditTiming {
    MonthEnd,
    #[default]
    NextMonthStart,
}

/// One marginal band: the slice of balance from the previous `up_to` up to this
/// limit earns `apy`. `up_to = None` is uncapped. Balance above the last finite
/// limit earns nothing unless an uncapped row follows.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RateTier {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub up_to: Option<Decimal>,
    #[serde(default)]
    pub apy: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YieldConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Assumed rate, used for any year the provider has not declared yet.
    /// Declared MP2 rates are app-wide and live in [`crate::interest::Mp2DividendRates`].
    /// Also the flat rate when `rate_tiers` is empty.
    #[serde(default)]
    pub apy: Decimal,
    /// Marginal APY bands. Empty means the single `apy` applies to the full balance.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rate_tiers: Vec<RateTier>,
    #[serde(default)]
    pub credit_frequency: CreditFrequency,
    #[serde(default)]
    pub monthly_credit_timing: MonthlyCreditTiming,
    /// Final withholding deducted from each credit, as a fraction (0.20 = 20%).
    /// Philippine bank interest is taxed at 20%; MP2 dividends are exempt.
    #[serde(default)]
    pub withholding_tax_rate: Decimal,
    /// Balance the account must hold on a given day to earn anything that day.
    #[serde(default)]
    pub minimum_balance: Decimal,
    /// `actual_360`, `actual_365`, or `actual_actual` (365/366).
    #[serde(default)]
    pub day_count: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
}

impl YieldConfig {
    pub fn day_count_basis(&self, date: NaiveDate) -> i64 {
        match self.day_count.as_deref() {
            Some(basis) if basis.eq_ignore_ascii_case(DAY_COUNT_ACTUAL_360) => 360,
            Some(basis) if basis.eq_ignore_ascii_case(DAY_COUNT_ACTUAL_ACTUAL) => {
                if NaiveDate::from_ymd_opt(date.year(), 2, 29).is_some() {
                    366
                } else {
                    365
                }
            }
            _ => 365,
        }
    }

    /// Sorted unique bands; empty stored tiers collapse to a single uncapped `apy` row.
    pub fn normalized_rate_tiers(&self) -> Vec<RateTier> {
        let mut tiers: Vec<RateTier> = self
            .rate_tiers
            .iter()
            .map(|tier| RateTier {
                up_to: tier.up_to.filter(|limit| *limit > Decimal::ZERO),
                apy: tier.apy.max(Decimal::ZERO),
            })
            .collect();
        if tiers.is_empty() {
            return vec![RateTier {
                up_to: None,
                apy: self.apy.max(Decimal::ZERO),
            }];
        }
        tiers.sort_by(|a, b| match (a.up_to, b.up_to) {
            (None, None) => std::cmp::Ordering::Equal,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (Some(_), None) => std::cmp::Ordering::Less,
            (Some(left), Some(right)) => left.cmp(&right),
        });
        let mut unique: Vec<RateTier> = Vec::new();
        for tier in tiers {
            if let Some(last) = unique.last_mut() {
                if last.up_to == tier.up_to {
                    *last = tier;
                    continue;
                }
            }
            unique.push(tier);
        }
        unique
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashProduct {
    #[serde(rename = "type")]
    pub product_type: CashProductType,
    #[serde(default = "default_compounding")]
    pub compounding: bool,
    #[serde(default)]
    pub yield_config: Option<YieldConfig>,
    #[serde(default)]
    pub target_amount: Option<Decimal>,
    #[serde(default)]
    pub first_contribution_date: Option<String>,
    #[serde(default)]
    pub maturity_date: Option<String>,
    #[serde(default)]
    pub mp2_account_number: Option<String>,
}

fn default_compounding() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductEnvelope {
    #[serde(default)]
    product: Option<ProductJson>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductJson {
    #[serde(rename = "type")]
    product_type: CashProductType,
    #[serde(default = "default_compounding")]
    compounding: bool,
    #[serde(rename = "yield")]
    #[serde(default)]
    yield_config: Option<YieldConfig>,
    #[serde(default)]
    target_amount: Option<Decimal>,
    #[serde(default)]
    first_contribution_date: Option<String>,
    #[serde(default)]
    maturity_date: Option<String>,
    #[serde(default)]
    mp2_account_number: Option<String>,
}

impl From<ProductJson> for CashProduct {
    fn from(value: ProductJson) -> Self {
        Self {
            product_type: value.product_type,
            compounding: value.compounding,
            yield_config: value.yield_config,
            target_amount: value.target_amount,
            first_contribution_date: value.first_contribution_date,
            maturity_date: value.maturity_date,
            mp2_account_number: value.mp2_account_number,
        }
    }
}

pub fn parse_ymd(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok()
}

pub fn parse_cash_product(meta: Option<&str>) -> Option<CashProduct> {
    let meta = meta?.trim();
    if meta.is_empty() {
        return None;
    }
    let parsed: ProductEnvelope = serde_json::from_str(meta).ok()?;
    parsed.product.map(CashProduct::from)
}

pub fn is_fixed_income_cash(account: &Account) -> bool {
    account
        .cash_allocation_category_id()
        .is_some_and(|id| id == CASH_CATEGORY_FIXED_INCOME)
}

impl Account {
    pub fn cash_product(&self) -> Option<CashProduct> {
        parse_cash_product(self.meta.as_deref())
    }

    pub fn is_mp2_account(&self) -> bool {
        matches!(
            self.cash_product().as_ref().map(|p| p.product_type),
            Some(CashProductType::PagibigMp2)
        )
    }

    pub fn is_hysa_account(&self) -> bool {
        matches!(
            self.cash_product().as_ref().map(|p| p.product_type),
            Some(CashProductType::Hysa)
        )
    }

    pub fn is_hysa_goal_account(&self) -> bool {
        matches!(
            self.cash_product().as_ref().map(|p| p.product_type),
            Some(CashProductType::HysaGoal)
        )
    }
}

pub fn mp2_maturity_date(first_contribution: NaiveDate) -> Option<NaiveDate> {
    first_contribution.checked_add_months(Months::new(MP2_TERM_YEARS * 12))
}

pub fn resolved_maturity_date(product: &CashProduct) -> Option<NaiveDate> {
    if let Some(raw) = product.maturity_date.as_deref().and_then(parse_ymd) {
        return Some(raw);
    }
    if product.product_type == CashProductType::PagibigMp2 {
        return product
            .first_contribution_date
            .as_deref()
            .and_then(parse_ymd)
            .and_then(mp2_maturity_date);
    }
    None
}

pub fn yield_start_date(product: &CashProduct) -> Option<NaiveDate> {
    product
        .yield_config
        .as_ref()
        .and_then(|y| y.start_date.as_deref())
        .and_then(parse_ymd)
        .or_else(|| {
            product
                .first_contribution_date
                .as_deref()
                .and_then(parse_ymd)
        })
}

pub fn is_year_end(date: NaiveDate) -> bool {
    date.month() == 12 && date.day() == 31
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn parses_product_meta() {
        let meta = r#"{
            "allocation": {"cashCategoryId": "FIXED_INCOME"},
            "product": {
                "type": "PAGIBIG_MP2",
                "compounding": true,
                "yield": {"enabled": true, "apy": 0.065, "creditFrequency": "yearly", "startDate": "2024-03-15"},
                "firstContributionDate": "2024-03-15"
            }
        }"#;
        let product = parse_cash_product(Some(meta)).unwrap();
        assert_eq!(product.product_type, CashProductType::PagibigMp2);
        assert!(product.compounding);
        let yield_cfg = product.yield_config.unwrap();
        assert_eq!(yield_cfg.apy, dec!(0.065));
        assert!(yield_cfg.rate_tiers.is_empty());
        assert_eq!(yield_cfg.credit_frequency, CreditFrequency::Yearly);
        assert_eq!(
            mp2_maturity_date(parse_ymd("2024-03-15").unwrap()).unwrap(),
            parse_ymd("2029-03-15").unwrap()
        );
    }

    #[test]
    fn account_type_helpers() {
        let account = Account {
            meta: Some(
                r#"{"allocation":{"cashCategoryId":"FIXED_INCOME"},"product":{"type":"HYSA"}}"#
                    .into(),
            ),
            ..Account::default()
        };
        assert!(account.is_hysa_account());
        assert!(!account.is_mp2_account());
        assert!(!account.is_hysa_goal_account());
        assert!(is_fixed_income_cash(&account));
    }

    #[test]
    fn empty_tiers_normalize_to_flat_apy() {
        let yield_cfg = YieldConfig {
            enabled: true,
            apy: dec!(0.05),
            rate_tiers: vec![],
            credit_frequency: CreditFrequency::Daily,
            monthly_credit_timing: MonthlyCreditTiming::NextMonthStart,
            withholding_tax_rate: Decimal::ZERO,
            minimum_balance: Decimal::ZERO,
            day_count: None,
            start_date: None,
        };
        let tiers = yield_cfg.normalized_rate_tiers();
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].up_to, None);
        assert_eq!(tiers[0].apy, dec!(0.05));
    }

    #[test]
    fn normalizes_tier_order_and_duplicate_limits() {
        let yield_cfg = YieldConfig {
            enabled: true,
            apy: dec!(0.03),
            rate_tiers: vec![
                RateTier {
                    up_to: Some(dec!(100000)),
                    apy: dec!(0.08),
                },
                RateTier {
                    up_to: Some(dec!(20000)),
                    apy: dec!(0.04),
                },
                RateTier {
                    up_to: Some(dec!(20000)),
                    apy: dec!(0.041),
                },
            ],
            credit_frequency: CreditFrequency::Monthly,
            monthly_credit_timing: MonthlyCreditTiming::NextMonthStart,
            withholding_tax_rate: Decimal::ZERO,
            minimum_balance: Decimal::ZERO,
            day_count: None,
            start_date: None,
        };
        let tiers = yield_cfg.normalized_rate_tiers();
        assert_eq!(tiers[0].up_to, Some(dec!(20000)));
        assert_eq!(tiers[0].apy, dec!(0.041));
        assert_eq!(tiers[1].up_to, Some(dec!(100000)));
    }
}
