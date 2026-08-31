use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::accounts::Account;

pub const FIXED_INCOME_CATEGORY_ID: &str = "FIXED_INCOME";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CashProductType {
    Hysa,
    HysaGoal,
    PagibigMp2,
}

impl CashProductType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Hysa => "HYSA",
            Self::HysaGoal => "HYSA_GOAL",
            Self::PagibigMp2 => "PAGIBIG_MP2",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_uppercase().as_str() {
            "HYSA" => Some(Self::Hysa),
            "HYSA_GOAL" => Some(Self::HysaGoal),
            "PAGIBIG_MP2" | "MP2" => Some(Self::PagibigMp2),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CreditFrequency {
    #[default]
    Daily,
    Monthly,
    Yearly,
}

impl CreditFrequency {
    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "daily" => Some(Self::Daily),
            "monthly" => Some(Self::Monthly),
            "yearly" => Some(Self::Yearly),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Monthly => "monthly",
            Self::Yearly => "yearly",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct YieldConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub apy: f64,
    #[serde(default)]
    pub credit_frequency: String,
    #[serde(default = "default_monthly_credit_timing")]
    pub monthly_credit_timing: String,
    #[serde(default = "default_day_count")]
    pub day_count: String,
    pub start_date: Option<String>,
}

fn default_day_count() -> String {
    "actual_365".to_string()
}

fn default_monthly_credit_timing() -> String {
    "next_month_start".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProductConfig {
    #[serde(rename = "type")]
    pub product_type: String,
    #[serde(default = "default_compounding")]
    pub compounding: bool,
    #[serde(default, rename = "yield")]
    pub yield_config: YieldConfig,
    pub target_amount: Option<f64>,
    pub first_contribution_date: Option<String>,
    pub maturity_date: Option<String>,
    pub mp2_account_number: Option<String>,
}

fn default_compounding() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountProductMeta {
    pub allocation: Option<AllocationMeta>,
    pub product: Option<ProductConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AllocationMeta {
    pub cash_category_id: Option<String>,
}

pub fn parse_account_meta(meta: Option<&str>) -> AccountProductMeta {
    let Some(raw) = meta.filter(|m| !m.trim().is_empty()) else {
        return AccountProductMeta::default();
    };
    serde_json::from_str(raw).unwrap_or_default()
}

pub fn serialize_account_meta(meta: &AccountProductMeta) -> String {
    serde_json::to_string(meta).unwrap_or_else(|_| "{}".to_string())
}

pub fn is_cash_product_account(account: &Account) -> bool {
    parse_account_meta(account.meta.as_deref())
        .product
        .as_ref()
        .and_then(|p| CashProductType::parse(&p.product_type))
        .is_some()
}

pub fn is_mp2_account(account: &Account) -> bool {
    product_type(account) == Some(CashProductType::PagibigMp2)
}

pub fn is_hysa_account(account: &Account) -> bool {
    matches!(
        product_type(account),
        Some(CashProductType::Hysa) | Some(CashProductType::HysaGoal)
    )
}

pub fn product_type(account: &Account) -> Option<CashProductType> {
    parse_account_meta(account.meta.as_deref())
        .product
        .as_ref()
        .and_then(|p| CashProductType::parse(&p.product_type))
}

pub fn compute_mp2_maturity(first_contribution: NaiveDate) -> NaiveDate {
    first_contribution
        .with_year(first_contribution.year() + 5)
        .unwrap_or(first_contribution)
}

pub fn credit_frequency(product: &ProductConfig) -> CreditFrequency {
    CreditFrequency::parse(&product.yield_config.credit_frequency).unwrap_or_else(|| {
        if CashProductType::parse(&product.product_type) == Some(CashProductType::PagibigMp2) {
            CreditFrequency::Yearly
        } else {
            CreditFrequency::Daily
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mp2_meta() {
        let raw = r#"{"allocation":{"cashCategoryId":"FIXED_INCOME"},"product":{"type":"PAGIBIG_MP2","compounding":true,"yield":{"enabled":true,"apy":0.0712,"creditFrequency":"yearly","startDate":"2024-01-15"}}}"#;
        let meta = parse_account_meta(Some(raw));
        let product = meta.product.expect("product");
        assert_eq!(product.product_type, "PAGIBIG_MP2");
        assert!(product.compounding);
        assert_eq!(product.yield_config.apy, 0.0712);
        assert_eq!(credit_frequency(&product), CreditFrequency::Yearly);
    }

    #[test]
    fn mp2_maturity_is_five_years() {
        let first = NaiveDate::from_ymd_opt(2024, 3, 1).unwrap();
        let maturity = compute_mp2_maturity(first);
        assert_eq!(maturity, NaiveDate::from_ymd_opt(2029, 3, 1).unwrap());
    }
}
