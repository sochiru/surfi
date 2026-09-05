//! Dividend event data returned by market data providers.

/// A cash dividend event from a market data provider.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DividendEvent {
    pub amount: f64,
    /// Ex-dividend date, unix seconds (UTC midnight when the provider sends a calendar date).
    pub date: i64,
    /// Payment date, unix seconds, when the provider supplies it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment_date: Option<i64>,
}
