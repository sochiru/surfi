use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::model::SOURCE_SYSTEM;

pub const SETTINGS_KEY: &str = "dividend_sync_settings";
pub const DEFAULT_TAX_RATE_PSE: f64 = 0.10;
pub const DEFAULT_TAX_RATE_OTHER: f64 = 0.0;
pub const PSE_MIC: &str = "XPHS";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDividendSettings {
    pub enabled: bool,
    /// Withholding tax rate in \[0, 1\].
    pub dividend_tax_rate: f64,
}

impl Default for AccountDividendSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            dividend_tax_rate: DEFAULT_TAX_RATE_OTHER,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DividendSyncSettings {
    pub global_enabled: bool,
    pub accounts: HashMap<String, AccountDividendSettings>,
}

impl DividendSyncSettings {
    pub fn ensure_account(
        &mut self,
        account_id: &str,
        default_tax: f64,
    ) -> &AccountDividendSettings {
        self.accounts
            .entry(account_id.to_string())
            .or_insert_with(|| AccountDividendSettings {
                enabled: false,
                dividend_tax_rate: default_tax.clamp(0.0, 1.0),
            })
    }

    pub fn account_settings(&self, account_id: &str) -> AccountDividendSettings {
        self.accounts.get(account_id).cloned().unwrap_or_default()
    }
}

pub fn default_tax_for_currency_or_mic(currency: &str, mic: Option<&str>) -> f64 {
    if mic == Some(PSE_MIC) || currency.eq_ignore_ascii_case("PHP") {
        DEFAULT_TAX_RATE_PSE
    } else {
        DEFAULT_TAX_RATE_OTHER
    }
}

pub fn _source_tag() -> &'static str {
    SOURCE_SYSTEM
}
