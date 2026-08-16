//! Market-data dividend automation.
//!
//! Auto-creates `DIVIDEND` activities from provider history using shares held
//! at each ex-date, scoped per account.

mod model;
mod projection;
mod settings;
mod shares;
mod sync;

pub use model::{
    DividendCalendarEvent, DividendCalendarEventKind, DividendSyncAccountResult,
    DividendSyncResult, SOURCE_SYSTEM, SOURCE_SYSTEM_LEGACY_ADDON,
};
pub use settings::{
    AccountDividendSettings, DividendSyncSettings, DEFAULT_TAX_RATE_PSE, SETTINGS_KEY,
};
pub use projection::{project_future_dividends, ProjectedDividend};
pub use shares::{compute_shares_at_ex_date, TradeLikeActivity};
pub use sync::{AssetDividendView, DividendSyncService, DividendSyncServiceTrait};
