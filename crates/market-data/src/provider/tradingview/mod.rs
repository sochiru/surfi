//! TradingView market data provider.
//!
//! Uses the TradingView Data API via RapidAPI.
//! The API is EOD (daily candles) oriented for historical backfills.
//!
//! Endpoints:
//! - GET `/api/quote/{symbol}`     (latest + profile; RapidAPI wraps fields in `data.data`)
//! - GET `/api/price/{symbol}`     (historical: `data.history` + optional `data.current`, bars use
//!   `time` / `open` / `close` / `max` / `min` / `volume`; also supports legacy parallel `t`/`o`/… arrays)

use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use log::{debug, warn};
use reqwest::Client;
use rust_decimal::Decimal;
use serde_json::Value;

use crate::errors::MarketDataError;
use crate::models::{
    AssetProfile, Coverage, InstrumentKind, ProviderId, ProviderInstrument, Quote, QuoteContext,
};
use crate::provider::{MarketDataProvider, ProviderCapabilities, RateLimit};
use crate::resolver::ResolverChain;
use crate::SymbolResolver;

const BASE_URL: &str = "https://tradingview-data1.p.rapidapi.com";
const RAPIDAPI_HOST: &str = "tradingview-data1.p.rapidapi.com";
const PROVIDER_ID: &str = "TRADINGVIEW";

/// Market data provider implementation for TradingView (via RapidAPI).
pub struct TradingViewProvider {
    client: Client,
    api_key: String,
}

impl TradingViewProvider {
    pub fn new(api_key: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client, api_key }
    }

    async fn fetch_json(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<Value, MarketDataError> {
        use reqwest::StatusCode;

        // Encode symbol-path segments (caller passes full path including symbol).
        let url = format!("{}{}", BASE_URL, path);
        let mut request = self
            .client
            .get(url)
            .header("x-rapidapi-host", RAPIDAPI_HOST)
            .header("x-rapidapi-key", &self.api_key);

        for (k, v) in query {
            request = request.query(&[(k, v)]);
        }

        debug!("TradingView request: {} query_count={}", path, query.len());

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
        if status == StatusCode::TOO_MANY_REQUESTS {
            let body = response.text().await.unwrap_or_default();
            warn!("TradingView rate limited (HTTP 429): {}", body);
            return Err(MarketDataError::RateLimited {
                provider: PROVIDER_ID.to_string(),
            });
        }

        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
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

        let text = response
            .text()
            .await
            .map_err(|e| MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Failed to read response body: {}", e),
            })?;

        serde_json::from_str::<Value>(&text).map_err(|e| MarketDataError::ProviderError {
            provider: PROVIDER_ID.to_string(),
            message: format!("Failed to parse JSON: {}", e),
        })
    }

    fn extract_symbol(&self, instrument: &ProviderInstrument) -> Result<String, MarketDataError> {
        match instrument {
            ProviderInstrument::EquitySymbol { symbol } => Ok(symbol.to_string()),
            _ => Err(MarketDataError::UnsupportedAssetType(format!(
                "TradingView only supports equities for now (got {:?})",
                instrument
            ))),
        }
    }

    fn get_currency(&self, context: &QuoteContext) -> String {
        // Avoid passing references to temporaries into the resolver chain.
        let provider_id: ProviderId = PROVIDER_ID.into();

        let resolved = ResolverChain::new()
            .get_currency(&provider_id, context)
            .or_else(|| context.currency_hint.clone());

        match resolved {
            Some(c) => c.to_string(),
            None => "USD".to_string(),
        }
    }

    fn parse_unix_timestamp(ts: i64) -> DateTime<Utc> {
        // Heuristic: if ts looks like ms, convert to seconds.
        let (secs, nanos) = if ts > 1_000_000_000_000 {
            (ts / 1000, ((ts % 1000) * 1_000_000) as u32)
        } else {
            (ts, 0)
        };

        Utc.timestamp_opt(secs, nanos)
            .single()
            .unwrap_or_else(Utc::now)
    }

    fn parse_status(value: &Value) -> Option<&str> {
        value.get("s").and_then(|v| v.as_str())
    }

    fn expect_api_success(root: &Value) -> Result<(), MarketDataError> {
        if root.get("success").and_then(|v| v.as_bool()) == Some(false) {
            let msg = root
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("TradingView API reported failure");
            return Err(MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: msg.to_string(),
            });
        }
        Ok(())
    }

    /// Quote and profile fields live under `response.data.data` for RapidAPI; older flat shapes are accepted.
    fn resolve_quote_body(root: &Value) -> Result<&Value, MarketDataError> {
        Self::expect_api_success(root)?;
        let outer = root
            .get("data")
            .ok_or_else(|| MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: "TradingView quote response missing data".to_string(),
            })?;
        if let Some(inner) = outer.get("data") {
            if inner.get("lp").is_some()
                || inner.get("open_price").is_some()
                || inner.get("currency_code").is_some()
            {
                return Ok(inner);
            }
        }
        if outer.get("lp").is_some() {
            return Ok(outer);
        }
        Err(MarketDataError::ProviderError {
            provider: PROVIDER_ID.to_string(),
            message: "TradingView quote response missing quote fields".to_string(),
        })
    }

    /// Inner object for `/api/price`: `symbol`, `history`, `current`, `info`, or legacy candle arrays.
    fn resolve_price_body(root: &Value) -> Result<&Value, MarketDataError> {
        Self::expect_api_success(root)?;
        root.get("data")
            .ok_or_else(|| MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: "TradingView price response missing data".to_string(),
            })
    }

    fn decimal_from_json(v: &Value) -> Option<Decimal> {
        v.as_f64()
            .or_else(|| v.as_i64().map(|i| i as f64))
            .and_then(|n| Decimal::try_from(n).ok())
    }

    /// One bar from getPrice `history` / `current` objects (`max`/`min` = high/low).
    fn quote_from_price_bar(obj: &Value, currency: &str) -> Option<Quote> {
        let ts = obj
            .get("time")
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))?;
        let timestamp = Self::parse_unix_timestamp(ts);

        let close_f = obj
            .get("close")
            .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))?;
        let close = Decimal::try_from(close_f).ok()?;

        let open = obj.get("open").and_then(Self::decimal_from_json);
        let high = obj
            .get("max")
            .or_else(|| obj.get("high"))
            .and_then(Self::decimal_from_json);
        let low = obj
            .get("min")
            .or_else(|| obj.get("low"))
            .and_then(Self::decimal_from_json);
        let volume = obj.get("volume").and_then(Self::decimal_from_json);

        Some(Quote {
            timestamp,
            open,
            high,
            low,
            close,
            volume,
            currency: currency.to_string(),
            source: PROVIDER_ID.to_string(),
        })
    }

    fn currency_from_price_data(data: &Value, fallback: &str) -> String {
        data.get("info")
            .and_then(|i| i.get("currency_code"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(fallback)
            .to_string()
    }

    /// Parse `/api/price` body: prefer `history` (+ optional `current`), else legacy `t`/`o`/`h`/`l`/`c`/`v`.
    fn parse_historical_from_price_data(
        data: &Value,
        fallback_currency: &str,
    ) -> Result<Vec<Quote>, MarketDataError> {
        let currency = Self::currency_from_price_data(data, fallback_currency);

        if Self::parse_status(data).is_some_and(|s| !matches!(s, "ok" | "OK")) {
            if matches!(data.get("s").and_then(|v| v.as_str()), Some("no_data")) {
                return Err(MarketDataError::NoDataForRange);
            }
            return Err(MarketDataError::ProviderError {
                provider: PROVIDER_ID.to_string(),
                message: format!("Unexpected TradingView price status: {:?}", data.get("s")),
            });
        }

        let mut quotes: Vec<Quote> = Vec::new();

        if let Some(history) = data.get("history").and_then(|v| v.as_array()) {
            for item in history {
                if let Some(q) = Self::quote_from_price_bar(item, &currency) {
                    quotes.push(q);
                }
            }
        }

        if let Some(current) = data.get("current") {
            if let Some(q) = Self::quote_from_price_bar(current, &currency) {
                let dup = quotes.iter().any(|x| x.timestamp == q.timestamp);
                if !dup {
                    quotes.push(q);
                }
            }
        }

        if !quotes.is_empty() {
            quotes.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            return Ok(quotes);
        }

        // Legacy parallel arrays (same envelope or flat).
        let t = data.get("t").and_then(|v| v.as_array());
        let o = data.get("o").and_then(|v| v.as_array());
        let h = data.get("h").and_then(|v| v.as_array());
        let l = data.get("l").and_then(|v| v.as_array());
        let c = data.get("c").and_then(|v| v.as_array());
        let v_arr = data.get("v").and_then(|v| v.as_array());

        let Some(t) = t else {
            return Err(MarketDataError::NoDataForRange);
        };
        let Some(o) = o else {
            return Err(MarketDataError::NoDataForRange);
        };
        let Some(h) = h else {
            return Err(MarketDataError::NoDataForRange);
        };
        let Some(l) = l else {
            return Err(MarketDataError::NoDataForRange);
        };
        let Some(c) = c else {
            return Err(MarketDataError::NoDataForRange);
        };
        let Some(v_arr) = v_arr else {
            return Err(MarketDataError::NoDataForRange);
        };

        let len = t.len();
        if o.len() != len
            || h.len() != len
            || l.len() != len
            || c.len() != len
            || v_arr.len() != len
            || len == 0
        {
            return Err(MarketDataError::NoDataForRange);
        }

        for i in 0..len {
            let ts = t[i].as_i64().or_else(|| t[i].as_f64().map(|f| f as i64));
            let Some(ts) = ts else {
                continue;
            };
            let timestamp = Self::parse_unix_timestamp(ts);

            let open = o[i]
                .as_f64()
                .or_else(|| o[i].as_i64().map(|x| x as f64))
                .and_then(|n| Decimal::try_from(n).ok());
            let high = h[i]
                .as_f64()
                .or_else(|| h[i].as_i64().map(|x| x as f64))
                .and_then(|n| Decimal::try_from(n).ok());
            let low = l[i]
                .as_f64()
                .or_else(|| l[i].as_i64().map(|x| x as f64))
                .and_then(|n| Decimal::try_from(n).ok());

            let close_f = c[i].as_f64().or_else(|| c[i].as_i64().map(|x| x as f64));
            let Some(close_f) = close_f else {
                continue;
            };
            let close = match Decimal::try_from(close_f) {
                Ok(d) => d,
                Err(_) => continue,
            };

            let volume = v_arr[i]
                .as_f64()
                .or_else(|| v_arr[i].as_i64().map(|x| x as f64))
                .and_then(|n| Decimal::try_from(n).ok());

            quotes.push(Quote {
                timestamp,
                open,
                high,
                low,
                close,
                volume,
                currency: currency.clone(),
                source: PROVIDER_ID.to_string(),
            });
        }

        quotes.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        if quotes.is_empty() {
            return Err(MarketDataError::NoDataForRange);
        }

        Ok(quotes)
    }

    async fn fetch_latest_payload(&self, symbol: &str) -> Result<Value, MarketDataError> {
        let encoded = urlencoding::encode(symbol);
        let path = format!("/api/quote/{}", encoded);
        self.fetch_json(&path, &[]).await
    }

    async fn fetch_historical_payload(
        &self,
        symbol: &str,
        range_days: i64,
    ) -> Result<Value, MarketDataError> {
        let encoded = urlencoding::encode(symbol);
        let path = format!("/api/price/{}", encoded);

        let timeframe = "D".to_string();
        let range = range_days.to_string();
        let query = vec![("timeframe", timeframe), ("range", range)];
        self.fetch_json(&path, &query).await
    }

    fn symbol_name_from_payload(payload: &Value) -> Option<String> {
        payload
            .get("short_name")
            .or_else(|| payload.get("n"))
            .or_else(|| payload.get("name"))
            .or_else(|| payload.get("symbol"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    fn parse_profile_from_payload(payload: &Value) -> Result<AssetProfile, MarketDataError> {
        let source = PROVIDER_ID.to_string();

        // TradingView payload shape isn't 100% guaranteed; be defensive.
        let sector = payload
            .get("sector")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let industry = payload
            .get("industry")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let market_cap = payload
            .get("market_cap")
            .or_else(|| payload.get("market_capitalization"))
            .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)));

        let website = payload
            .get("website")
            .or_else(|| payload.get("weburl"))
            .or_else(|| payload.get("web_site_url"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let description = payload
            .get("description")
            .or_else(|| payload.get("business_description"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let logo_url = payload
            .get("logo_url")
            .or_else(|| payload.get("logo"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let employees = payload
            .get("employees")
            .or_else(|| payload.get("employee_total"))
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.as_i64().and_then(|i| i.try_into().ok()))
            });

        let quote_type = payload
            .get("quote_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| Some("EQUITY".to_string()));

        let name = Self::symbol_name_from_payload(payload);
        if name.is_none() && sector.is_none() && industry.is_none() && market_cap.is_none() {
            return Err(MarketDataError::SymbolNotFound(format!(
                "No profile data in TradingView payload for provider='{}'",
                PROVIDER_ID
            )));
        }

        Ok(AssetProfile {
            source: Some(source),
            name,
            quote_type,
            sector,
            sectors: None,
            asset_allocation: None,
            industry,
            website,
            description,
            country: payload
                .get("country")
                .or_else(|| payload.get("country_code"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            employees,
            logo_url,
            market_cap,
            pe_ratio: payload
                .get("pe_ratio")
                .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64))),
            dividend_yield: payload
                .get("dividend_yield")
                .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64))),
            week_52_high: payload
                .get("week_52_high")
                .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64))),
            week_52_low: payload
                .get("week_52_low")
                .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64))),
            isin: payload
                .get("isin")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        })
    }
}

// ============================================================================
// MarketDataProvider Implementation
// ============================================================================

#[async_trait]
impl MarketDataProvider for TradingViewProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn priority(&self) -> u8 {
        // Lower than Finnhub/AlphaVantage due to strict rate limits.
        // Background periodic sync skips this provider; manual Sync only.
        4
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            instrument_kinds: &[InstrumentKind::Equity],
            coverage: Coverage::global_best_effort(),
            supports_latest: true,
            supports_historical: true,
            supports_search: false,
            supports_profile: true,
            supports_dividends: false,
        }
    }

    fn rate_limit(&self) -> RateLimit {
        RateLimit {
            requests_per_minute: 10,
            max_concurrency: 1,
            min_delay: Duration::from_millis(100),
        }
    }

    async fn get_latest_quote(
        &self,
        context: &QuoteContext,
        instrument: ProviderInstrument,
    ) -> Result<Quote, MarketDataError> {
        let symbol = self.extract_symbol(&instrument)?;
        let fallback_currency = self.get_currency(context);

        let root = self.fetch_latest_payload(&symbol).await?;
        let payload = Self::resolve_quote_body(&root)?;

        if Self::parse_status(payload).is_some_and(|s| !matches!(s, "ok" | "OK")) {
            return Err(MarketDataError::SymbolNotFound(format!(
                "TradingView returned non-ok status for {}: {:?}",
                symbol,
                payload.get("s")
            )));
        }

        let close = match payload.get("lp") {
            Some(v) => v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)),
            None => None,
        }
        .and_then(|n| Decimal::try_from(n).ok())
        .ok_or_else(|| {
            MarketDataError::SymbolNotFound(format!("No latest price for {}", symbol))
        })?;

        let timestamp = payload
            .get("lp_time")
            .or_else(|| payload.get("t"))
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
            .map(Self::parse_unix_timestamp)
            .unwrap_or_else(Utc::now);

        let open = payload
            .get("open_price")
            .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
            .and_then(|n| Decimal::try_from(n).ok());

        let high = payload
            .get("high_price")
            .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
            .and_then(|n| Decimal::try_from(n).ok());

        let low = payload
            .get("low_price")
            .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
            .and_then(|n| Decimal::try_from(n).ok());

        let volume = payload
            .get("volume")
            .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
            .and_then(|n| Decimal::try_from(n).ok());

        let currency = payload
            .get("currency_code")
            .and_then(|v| v.as_str())
            .unwrap_or(fallback_currency.as_str())
            .to_string();

        Ok(Quote {
            timestamp,
            open,
            high,
            low,
            close,
            volume,
            currency,
            source: PROVIDER_ID.to_string(),
        })
    }

    async fn get_historical_quotes(
        &self,
        context: &QuoteContext,
        instrument: ProviderInstrument,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<Quote>, MarketDataError> {
        let symbol = self.extract_symbol(&instrument)?;

        let start_day = start.date_naive();
        let end_day = end.date_naive();
        if end_day < start_day {
            return Ok(vec![]);
        }

        let range_days = (end_day - start_day).num_days() + 1;
        let range_days = range_days.max(1);
        let fallback_currency = self.get_currency(context);

        let root = self.fetch_historical_payload(&symbol, range_days).await?;
        let data = Self::resolve_price_body(&root)?;
        Self::parse_historical_from_price_data(data, fallback_currency.as_str())
    }

    async fn get_profile(&self, symbol: &str) -> Result<AssetProfile, MarketDataError> {
        let root = self.fetch_latest_payload(symbol).await?;
        let body = Self::resolve_quote_body(&root)?;
        Self::parse_profile_from_payload(body)
    }
}

// ============================================================================
// Tests (unit-level, no network)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;
    use std::sync::Arc;

    #[test]
    fn test_extract_symbol_equity() {
        let provider = TradingViewProvider::new("test_key".to_string());
        let instrument = ProviderInstrument::EquitySymbol {
            symbol: Arc::from("PSE:SM"),
        };
        let symbol = provider.extract_symbol(&instrument).unwrap();
        assert_eq!(symbol, "PSE:SM");
    }

    #[test]
    fn test_parse_unix_timestamp_seconds() {
        let ts = 1_700_000_000_i64; // seconds
        let dt = TradingViewProvider::parse_unix_timestamp(ts);
        // Basic sanity: year should be >= 2020.
        assert!(dt.year() >= 2020);
    }

    #[test]
    fn test_resolve_quote_body_rapidapi_envelope() {
        let root = serde_json::json!({
            "success": true,
            "data": {
                "symbol": "PSE:CREIT",
                "data": {
                    "lp": 3.36,
                    "lp_time": 1774421833_i64,
                    "open_price": 3.24,
                    "high_price": 3.38,
                    "low_price": 3.24,
                    "volume": 2091000.0,
                    "currency_code": "PHP"
                }
            }
        });
        let inner = TradingViewProvider::resolve_quote_body(&root).unwrap();
        assert_eq!(inner.get("lp").and_then(|v| v.as_f64()), Some(3.36));
    }

    #[test]
    fn test_parse_historical_from_getprice_history_shape() {
        let data = serde_json::json!({
            "symbol": "PSE:CREIT",
            "history": [
                {"time": 1774420620_i64, "open": 3.35, "close": 3.35, "max": 3.35, "min": 3.35, "volume": 4000},
                {"time": 1774421820_i64, "open": 3.36, "close": 3.36, "max": 3.36, "min": 3.36, "volume": 1000}
            ],
            "info": { "currency_code": "PHP" }
        });
        let quotes = TradingViewProvider::parse_historical_from_price_data(&data, "USD").unwrap();
        assert_eq!(quotes.len(), 2);
        assert_eq!(quotes[0].close, rust_decimal_macros::dec!(3.35));
        assert_eq!(quotes[1].volume, Some(rust_decimal_macros::dec!(1000)));
        assert_eq!(quotes[0].currency, "PHP");
    }
}
