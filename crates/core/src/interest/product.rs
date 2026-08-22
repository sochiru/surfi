//! Cash-product metadata on CASH accounts (HYSA, goal pots, Pag-IBIG MP2).

use chrono::{Datelike, Months, NaiveDate};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::accounts::Account;

pub const CASH_CATEGORY_FIXED_INCOME: &str = "FIXED_INCOME";
pub const MP2_GROUP: &str = "Pag-IBIG";
pub const MP2_TERM_YEARS: u32 = 5;
pub const DAY_COUNT_ACTUAL_360: &str = "actual_360";

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YieldConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Assumed rate, used for any year the provider has not declared yet.
    /// Declared MP2 rates are app-wide and live in [`crate::interest::Mp2DividendRates`].
    #[serde(default)]
    pub apy: Decimal,
    #[serde(default)]
    pub credit_frequency: CreditFrequency,
    /// Final withholding deducted from each credit, as a fraction (0.20 = 20%).
    /// Philippine bank interest is taxed at 20%; MP2 dividends are exempt.
    #[serde(default)]
    pub withholding_tax_rate: Decimal,
    /// Balance the account must hold on a given day to earn anything that day.
    #[serde(default)]
    pub minimum_balance: Decimal,
    /// `actual_360` or `actual_365`. A 360 basis pays slightly more per day for
    /// the same quoted rate, and is what many banks use.
    #[serde(default)]
    pub day_count: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
}

impl YieldConfig {
    pub fn day_count_basis(&self) -> i64 {
        match self.day_count.as_deref() {
            Some(basis) if basis.eq_ignore_ascii_case(DAY_COUNT_ACTUAL_360) => 360,
            _ => 365,
        }
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
}
