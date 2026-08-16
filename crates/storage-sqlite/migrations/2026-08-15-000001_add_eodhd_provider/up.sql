-- Add EODHD provider (EOD historical + dividends)
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
    'EODHD',
    'EODHD',
    'Provides end-of-day historical prices and dividend history via the EODHD API (including PSE).',
    'https://eodhd.com/',
    5,
    FALSE,
    'eodhd.png',
    NULL,
    NULL,
    NULL
);
