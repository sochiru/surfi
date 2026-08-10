# Add PSE Support: TradingView Provider + Dividend Tracker Addon

> **Two deliverables:** (1) TradingView market data provider in core for PSE quotes, (2) PSE Dividend Tracker addon that auto-creates dividend transactions from TradingView dividend history.

## Todos

- [ ] Create `crates/market-data/src/provider/tradingview/mod.rs` implementing MarketDataProvider (get_latest_quote via /api/quote, get_historical_quotes via /api/price, get_profile from quote data)
- [ ] Add `pub mod tradingview` to `provider/mod.rs`, re-export in `lib.rs`
- [ ] Add `DATA_SOURCE_TRADINGVIEW` to `constants.rs` and `MARKET_DATA_PROVIDER_IDS`
- [ ] Add match arm in `client.rs` `create_provider()` for TRADINGVIEW (API key from SecretStore)
- [ ] Add TRADINGVIEW to `ProviderCapabilities::for_provider()` and `requires_key` match in `service.rs`
- [ ] Add XPHS entry to `exchanges.json` + PHP currency priority
- [ ] Create migration to INSERT TRADINGVIEW provider row
- [ ] Add `tradingview.png` logo
- [ ] Create `addons/pse-dividend-tracker/` with manifest, TradingView API client, dividend sync logic, and settings/calendar UI

---

## Part 1: TradingView Market Data Provider (Core)

Provides end-of-day quotes and profiles for PSE stocks (and any TradingView-supported exchange).

### API Endpoints Used

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `GET /api/quote/{symbol}` | Latest quote + profile | `lp`, `open_price`, `high_price`, `low_price`, `volume`, `currency_code`, `sector`, etc. |
| `GET /api/price/{symbol}?timeframe=D&range=N` | Historical backfill | `{ s, t[], o[], h[], l[], c[], v[] }` |

Auth: `x-rapidapi-host` + `x-rapidapi-key` headers.

### Files to Create/Modify

**New file:** `crates/market-data/src/provider/tradingview/mod.rs`
- Model after `crates/market-data/src/provider/finnhub/mod.rs`
- `get_latest_quote()` -> `/api/quote/{symbol}`, map `lp`->close, `open_price`->open, etc.
- `get_historical_quotes()` -> `/api/price/{symbol}?timeframe=D&range=N`, parse candle arrays
- `get_profile()` -> parse from `/api/quote` response (description, sector, industry, market_cap, etc.)
- Symbol format: `EXCHANGE:SYMBOL` (e.g., `PSE:SM`). Provider's `extract_symbol()` passes through the symbol as-is since the resolver will produce `PSE:SM`.
- Rate limit: `requests_per_minute: 10`, `max_concurrency: 1`

**Modified files (small additions each):**

- `crates/market-data/src/provider/mod.rs` -- add `pub mod tradingview;`
- `crates/market-data/src/lib.rs` -- add `pub use provider::tradingview::TradingViewProvider;`
- `crates/core/src/quotes/constants.rs` -- add `DATA_SOURCE_TRADINGVIEW`, expand array to 9
- `crates/core/src/quotes/client.rs` -- add match arm in `create_provider()` (API key pattern like Finnhub)
- `crates/core/src/quotes/provider_settings.rs` -- add `"TRADINGVIEW"` to `for_provider()`
- `crates/core/src/quotes/service.rs` -- add `DATA_SOURCE_TRADINGVIEW` to `requires_key` match
- `crates/market-data/src/resolver/exchanges.json` -- add XPHS entry + PHP currency priority

**New files:**
- `crates/storage-sqlite/migrations/YYYY-MM-DD-000001_add_tradingview_provider/up.sql` + `down.sql`
- Provider logo image

### Symbol Resolution for TradingView

TradingView uses `EXCHANGE:SYMBOL` format. The `RulesResolver` needs to produce this for the TRADINGVIEW provider.

Add a `tradingview` key to the XPHS exchange entry:

```json
{
  "mic": "XPHS",
  "name": "PSE",
  "long_name": "Philippine Stock Exchange",
  "currency": "PHP",
  "timezone": "Asia/Manila",
  "close": [14, 45],
  "tradingview": { "prefix": "PSE" }
}
```

Extend `resolve_equity` in `RulesResolver` to check for a `tradingview.prefix` key and produce `PSE:SM` instead of suffix-based `SM.PS`.

---

## Part 2: PSE Dividend Tracker Addon

An addon that auto-creates dividend transactions based on TradingView dividend history and current/historical holdings. Like Portseido's "Auto Cash Dividend" feature.

### TradingView Dividend Endpoint

`GET /api/market-data/{symbol}/dividend`

Response (parallel arrays, same index = same event):

```
dividend_ex_date_h[]      -- ex-dates (unix timestamps)
dividend_record_date_h[]  -- record dates
dividend_payment_date_h[] -- payment dates
dividend_amount_h[]       -- amount per share
dividend_type_h[]         -- "Final", "Interim", "Special"
```

### Addon Structure

```
addons/pse-dividend-tracker/
  manifest.json
  src/
    addon.tsx                -- entry: sidebar item + route + sync trigger
    pages/
      dividend-page.tsx      -- calendar view, sync button, settings
    services/
      tradingview-api.ts     -- fetch dividend data from RapidAPI
      dividend-sync.ts       -- core sync logic
    types.ts
```

### Addon Settings (stored via `ctx.api.secrets`)

The addon persists its configuration as a JSON blob in addon-scoped secrets:

```json
{
  "rapidApiKey": "...",
  "globalEnabled": true,
  "accounts": {
    "account-uuid-1": {
      "enabled": true,
      "dividendTaxRate": 0.10
    },
    "account-uuid-2": {
      "enabled": false,
      "dividendTaxRate": 0.25
    }
  }
}
```

- **Global toggle**: Enable/disable dividend sync entirely
- **Per-account settings**: Each account can be independently enabled/disabled with its own dividend withholding tax rate (e.g., 10% for Philippine tax residents, 25% for non-residents)
- Tax rate is applied as: `netDividend = grossDividend * (1 - taxRate)`, fee field stores the tax amount

### Activity Tagging for Auto-Generated Dividends

Auto-created dividend activities are tagged using existing Activity model fields (no schema changes needed):

- `source_system`: `"PSE_DIVIDEND_ADDON"` -- identifies the addon as the creator
- `idempotency_key`: `"pse-div:{symbol}:{exDateUnix}"` -- prevents duplicates on re-sync
- `metadata`: JSON with addon-specific details:
  ```json
  {
    "auto_generated": true,
    "addon_id": "pse-dividend-tracker",
    "gross_amount": 1112.00,
    "tax_rate": 0.10,
    "tax_amount": 111.20,
    "dividend_type": "Final",
    "ex_date": "2026-03-15",
    "record_date": "2026-03-16",
    "amount_per_share": 0.1112
  }
  ```

When the user **disables** the addon or turns off dividend sync:
- Query all activities where `source_system = "PSE_DIVIDEND_ADDON"`
- Prompt: "Remove all auto-created dividend transactions?" (Yes/No)
- If yes, bulk-delete via `ctx.api.activities.saveMany({ deletes: [...ids] })`

### Core Sync Algorithm (`dividend-sync.ts`)

```
settings = loadSettings()
if !settings.globalEnabled: return

For each account where settings.accounts[accountId].enabled:
  taxRate = settings.accounts[accountId].dividendTaxRate ?? 0
  holdings = ctx.api.portfolio.getHoldings(accountId)

  For each PSE holding (currency === "PHP" or exchange === "PSE"):
    dividendHistory = fetchDividendHistory(symbol)  // TradingView API
    existingDividends = ctx.api.activities.search({ symbol, activityTypes: "DIVIDEND" })
    buysSells = ctx.api.activities.search({ symbol, activityTypes: "BUY,SELL" })

    For each dividend event in dividendHistory:
      exDate = dividend_ex_date_h[i]
      amountPerShare = dividend_amount_h[i]

      // Deduplicate via idempotency key
      idempotencyKey = `pse-div:${symbol}:${exDate}`
      if existingDividends has entry with matching idempotencyKey: continue

      // Reconstruct shares held on ex-date by walking buy/sell history
      sharesAtExDate = computeSharesHeld(buysSells, exDate)
      if sharesAtExDate <= 0: continue

      // Calculate dividend with tax
      grossDividend = sharesAtExDate * amountPerShare
      taxAmount = grossDividend * taxRate
      netDividend = grossDividend - taxAmount

      newActivities.push({
        accountId,
        activityType: "DIVIDEND",
        date: paymentDate,
        symbol,
        amount: netDividend,
        fee: taxAmount,
        quantity: sharesAtExDate,
        unitPrice: amountPerShare,
        currency: "PHP",
        notes: "Auto-created by PSE Dividend Tracker",
        sourceSystem: "PSE_DIVIDEND_ADDON",
        idempotencyKey,
        metadata: JSON.stringify({
          auto_generated: true,
          addon_id: "pse-dividend-tracker",
          gross_amount: grossDividend,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          dividend_type: dividend_type_h[i],
          ex_date: formatDate(exDate),
          record_date: formatDate(recordDate),
          amount_per_share: amountPerShare
        })
      })

  ctx.api.activities.saveMany({ creates: newActivities })
```

### Addon APIs Used

| API | Method | Purpose |
|-----|--------|---------|
| `portfolio` | `getHoldings(accountId)` | List PSE holdings |
| `accounts` | `getAll()` | List all accounts |
| `activities` | `search(filters)` | Find existing dividends + buy/sell history |
| `activities` | `saveMany(request)` | Bulk-create dividend activities |
| `secrets` | `get/set` | Store RapidAPI key per addon |
| `events` | `market.onSyncComplete` | Optional: auto-trigger after market sync |
| `toast` | `success/error` | Notify user of sync results |
| `logger` | `info/error` | Debug logging |

### Addon UI

- **Sidebar item**: "PSE Dividends"
- **Main page**:
  - **Settings section**:
    - RapidAPI key input
    - Global enable/disable toggle for dividend sync
    - Per-account table: enable/disable toggle + dividend tax rate input (%) for each account
  - **Sync controls**:
    - "Sync Dividends Now" button (manual trigger)
    - "Remove All Auto-Created Dividends" button (filters by `source_system = "PSE_DIVIDEND_ADDON"`)
  - **Dividend calendar/table**: upcoming and past dividends with status (created/skipped/pending)
  - **Summary**: total gross dividends, tax withheld, net dividends received per year

### Manifest

```json
{
  "id": "pse-dividend-tracker",
  "name": "PSE Dividend Tracker",
  "version": "1.0.0",
  "description": "Auto-creates dividend transactions for Philippine Stock Exchange holdings using TradingView data.",
  "permissions": ["portfolio", "activities", "accounts", "secrets", "market", "toast"]
}
```

---

## Execution Order

1. **TradingView provider first** (Part 1) -- this is the foundation for PSE quote data
2. **Dividend addon second** (Part 2) -- builds on top, uses its own TradingView API calls (separate from the provider, since addons run in the frontend)

The addon calls TradingView directly from the browser (RapidAPI key stored in addon secrets), independent of the core market data provider. The provider handles quotes; the addon handles dividends.
