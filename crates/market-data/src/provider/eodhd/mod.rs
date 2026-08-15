//! EODHD market data provider.
//!
//! End-of-day historical prices and dividend history via the EODHD APIs:
//! - `GET /api/eod/{symbol}` — daily OHLCV (and latest via a short window)
//! - `GET /api/div/{symbol}` — cash dividend history (ex-date + value)
//!
//! Symbol format: `{TICKER}.{EXCHANGE}` (e.g. `SM.PSE`, `AAPL.US`).
//! Docs: https://eodhd.com/financial-apis/api-for-historical-data-and-volumes
//!       https://eodhd.com/financial-apis/api-splits-dividends

use std::str::FromStr;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use log::{debug, warn};
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::errors::MarketDataError;
use crate::models::{
    Coverage, DividendEvent, InstrumentKind, ProviderInstrument, Quote, QuoteContext,
};
use crate::provider::{MarketDataProvider, ProviderCapabilities, RateLimit};
use crate::resolver::ResolverChain;
use crate::SymbolResolver;

const BASE_URL: &str = "https://eodhd.com/api";
const PROVIDER_ID: &str = "EODHD";

/// EODHD market data provider (equities).
pub struct EodhdProvider {
    client: Client,
    api_key: String,
}

#[derive(Debug, Deserialize)]
struct EodBar {
    date: String,
    open: Option<f64>,
    high: Option<f64>,
    low: Option<f64>,
    close: f64,
    volume: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct DivBar {
    date: String,
    value: f64,
}

impl EodhdProvider {
    pub fn new(api_key: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client, api_key }
    }

    async fn fetch(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<String, MarketDataError> {
        let url = format!("{}{}", BASE_URL, path);

        let mut request = self.client.get(&url).query(&[
            ("api_token", self.api_key.as_str()),
            ("fmt", "json"),
        ]);

        for (key, value) in params {
            request = request.query(&[(*key, *value)]);
        }

        debug!("EODHD request: {} params={}", path, params.len());

        let response = request.send().await.map_err(|e| {
            if e.is_timeout() {
                MarketDataError::Timeout {
                    provider: PROVIDER_ID.to_string(),
                }
            } else {
                MarketDataError::ProviderError {
                    provider: PROVIDER_ID.to_string(),
                    message: format!("Request failed: {}", e),
                }
            }
        })?;

        let status = response.status();

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let body = response.text().await.unwrap_or_default();
            warn!("EODHD rate limited (HTTP 429): {}", body);
            return Err(MarketDataError::RateLimited {
                provider: PROVIDER_ID.to_string(),
            });
        }

        if matches!(
            status,
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
        ) {
            let body = response.text().await.unwrap_or_default();
            return Err(MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Access forbidden - check API key: {}", body),
            });
        }

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("HTTP {} - {}", status, body),
            });
        }

        response
            .text()
            .await
            .map_err(|e| MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Failed to read response: {}", e),
            })
    }

    fn extract_symbol(&self, instrument: &ProviderInstrument) -> Result<String, MarketDataError> {
        match instrument {
            ProviderInstrument::EquitySymbol { symbol } => Ok(symbol.to_string()),
            _ => Err(MarketDataError::UnsupportedAssetType(format!(
                "EODHD only supports equities for now (got {:?})",
                instrument
            ))),
        }
    }

    fn get_currency(&self, context: &QuoteContext) -> String {
        let chain = ResolverChain::new();
        chain
            .get_currency(&PROVIDER_ID.into(), context)
            .or_else(|| context.currency_hint.clone())
            .map(|c| c.to_string())
            .unwrap_or_else(|| "USD".to_string())
    }

    fn parse_date_midnight(date: &str) -> Result<DateTime<Utc>, MarketDataError> {
        let naive = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|e| {
            MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Invalid date '{}': {}", date, e),
            }
        })?;
        naive
            .and_hms_opt(0, 0, 0)
            .map(|dt| Utc.from_utc_datetime(&dt))
            .ok_or_else(|| MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Invalid date components for '{}'", date),
            })
    }

    fn decimal_from_f64(value: f64) -> Option<Decimal> {
        Decimal::from_str(&value.to_string()).ok()
    }

    fn quote_from_bar(bar: &EodBar, currency: &str) -> Result<Quote, MarketDataError> {
        let timestamp = Self::parse_date_midnight(&bar.date)?;
        let close = Self::decimal_from_f64(bar.close).ok_or_else(|| {
            MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Invalid close for {}", bar.date),
            }
        })?;

        Ok(Quote {
            timestamp,
            open: bar.open.and_then(Self::decimal_from_f64),
            high: bar.high.and_then(Self::decimal_from_f64),
            low: bar.low.and_then(Self::decimal_from_f64),
            close,
            volume: bar.volume.and_then(Self::decimal_from_f64),
            currency: currency.to_string(),
            source: PROVIDER_ID.to_string(),
        })
    }

    async fn fetch_eod(
        &self,
        symbol: &str,
        currency: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<Quote>, MarketDataError> {
        let encoded = urlencoding::encode(symbol);
        let path = format!("/eod/{}", encoded);
        let from = start.format("%Y-%m-%d").to_string();
        let to = end.format("%Y-%m-%d").to_string();
        let text = self
            .fetch(
                &path,
                &[
                    ("from", from.as_str()),
                    ("to", to.as_str()),
                    ("period", "d"),
                    ("order", "a"),
                ],
            )
            .await?;

        if text.trim().is_empty() || text.trim() == "[]" {
            return Err(MarketDataError::NoDataForRange);
        }

        let bars: Vec<EodBar> =
            serde_json::from_str(&text).map_err(|e| MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Failed to parse EOD response: {}", e),
            })?;

        if bars.is_empty() {
            return Err(MarketDataError::NoDataForRange);
        }

        let mut quotes = Vec::with_capacity(bars.len());
        for bar in &bars {
            match Self::quote_from_bar(bar, currency) {
                Ok(q) => quotes.push(q),
                Err(e) => warn!("EODHD skipping bar for {}: {}", symbol, e),
            }
        }

        if quotes.is_empty() {
            return Err(MarketDataError::NoDataForRange);
        }

        Ok(quotes)
    }

    async fn fetch_dividends(
        &self,
        symbol: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<DividendEvent>, MarketDataError> {
        let encoded = urlencoding::encode(symbol);
        let path = format!("/div/{}", encoded);
        let from = start.format("%Y-%m-%d").to_string();
        let to = end.format("%Y-%m-%d").to_string();
        let text = self
            .fetch(&path, &[("from", from.as_str()), ("to", to.as_str())])
            .await?;

        if text.trim().is_empty() || text.trim() == "[]" {
            return Ok(Vec::new());
        }

        let bars: Vec<DivBar> =
            serde_json::from_str(&text).map_err(|e| MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Failed to parse dividend response: {}", e),
            })?;

        let mut events = Vec::with_capacity(bars.len());
        for bar in bars {
            match Self::parse_date_midnight(&bar.date) {
                Ok(ts) => events.push(DividendEvent {
                    amount: bar.value,
                    date: ts.timestamp(),
                }),
                Err(e) => warn!("EODHD skipping dividend for {}: {}", symbol, e),
            }
        }
        events.sort_by_key(|d| d.date);
        Ok(events)
    }
}

#[async_trait]
impl MarketDataProvider for EodhdProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn priority(&self) -> u8 {
        5
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            instrument_kinds: &[InstrumentKind::Equity],
            coverage: Coverage::global_best_effort(),
            supports_latest: true,
            supports_historical: true,
            supports_search: false,
            supports_profile: false,
            supports_dividends: true,
        }
    }

    fn rate_limit(&self) -> RateLimit {
        RateLimit {
            // Paid plans allow 1000 requests/minute; stay under it with headroom.
            requests_per_minute: 600,
            max_concurrency: 8,
            min_delay: Duration::from_millis(50),
        }
    }

    async fn get_latest_quote(
        &self,
        context: &QuoteContext,
        instrument: ProviderInstrument,
    ) -> Result<Quote, MarketDataError> {
        let symbol = self.extract_symbol(&instrument)?;
        let currency = self.get_currency(context);
        let end = Utc::now();
        let start = end - chrono::Duration::days(14);

        debug!("Fetching latest EOD quote for {} from EODHD", symbol);

        let quotes = self.fetch_eod(&symbol, &currency, start, end).await?;
        quotes
            .into_iter()
            .next_back()
            .ok_or(MarketDataError::NoDataForRange)
    }

    async fn get_historical_quotes(
        &self,
        context: &QuoteContext,
        instrument: ProviderInstrument,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<Quote>, MarketDataError> {
        let symbol = self.extract_symbol(&instrument)?;
        let currency = self.get_currency(context);

        debug!(
            "Fetching historical quotes for {} from {} to {} from EODHD",
            symbol,
            start.format("%Y-%m-%d"),
            end.format("%Y-%m-%d")
        );

        self.fetch_eod(&symbol, &currency, start, end).await
    }

    async fn get_dividends(
        &self,
        _context: &QuoteContext,
        instrument: ProviderInstrument,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<DividendEvent>, MarketDataError> {
        let symbol = self.extract_symbol(&instrument)?;
        self.fetch_dividends(&symbol, start, end).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn test_provider_id_and_capabilities() {
        let provider = EodhdProvider::new("test_key".to_string());
        assert_eq!(provider.id(), "EODHD");
        assert_eq!(provider.priority(), 5);
        let caps = provider.capabilities();
        assert!(caps.supports_historical);
        assert!(caps.supports_latest);
        assert!(caps.supports_dividends);
        assert!(!caps.supports_search);
        assert!(!caps.supports_profile);
    }

    #[test]
    fn test_extract_symbol_equity() {
        let provider = EodhdProvider::new("test_key".to_string());
        let instrument = ProviderInstrument::EquitySymbol {
            symbol: Arc::from("SM.PSE"),
        };
        assert_eq!(provider.extract_symbol(&instrument).unwrap(), "SM.PSE");
    }

    #[test]
    fn test_quote_from_bar() {
        let bar = EodBar {
            date: "2024-06-03".to_string(),
            open: Some(100.0),
            high: Some(105.0),
            low: Some(99.0),
            close: 102.5,
            volume: Some(1_000_000.0),
        };
        let quote = EodhdProvider::quote_from_bar(&bar, "PHP").unwrap();
        assert_eq!(quote.currency, "PHP");
        assert_eq!(quote.source, "EODHD");
        assert_eq!(quote.close, Decimal::from_str("102.5").unwrap());
        assert_eq!(quote.open, Some(Decimal::from_str("100").unwrap()));
        assert_eq!(
            quote.timestamp,
            Utc.with_ymd_and_hms(2024, 6, 3, 0, 0, 0).unwrap()
        );
    }

    #[test]
    fn test_parse_dividends_json_shape() {
        let json = r#"[
            {"date":"2023-02-10","value":0.23,"currency":"USD"},
            {"date":"2023-05-12","value":0.24,"currency":"USD"}
        ]"#;
        let bars: Vec<DivBar> = serde_json::from_str(json).unwrap();
        assert_eq!(bars.len(), 2);
        assert_eq!(bars[0].value, 0.23);
        assert_eq!(bars[1].date, "2023-05-12");
    }
}
