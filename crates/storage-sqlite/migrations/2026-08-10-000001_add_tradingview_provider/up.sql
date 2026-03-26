-- Add TradingView provider (via RapidAPI)
INSERT OR IGNORE INTO market_data_providers (
    id,
    name,
    description,
    url,
    priority,
    enabled,
    logo_filename,
    last_synced_at,
    last_sync_status,
    last_sync_error
)
VALUES (
    'TRADINGVIEW',
    'TradingView',
    'Provides end-of-day quotes and company profile data via the TradingView Data API (RapidAPI).',
    'https://tradingviewapi.com/',
    5,
    FALSE,
    'tradingview.png',
    NULL,
    NULL,
    NULL
);

