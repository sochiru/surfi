-- Durable cache for market-data dividend history (ex-date + amount).
CREATE TABLE IF NOT EXISTS dividend_event_cache (
    cache_key TEXT PRIMARY KEY NOT NULL,
    fetched_at TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dividend_event_cache_fetched_at
    ON dividend_event_cache (fetched_at);
