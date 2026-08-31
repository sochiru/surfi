mod accrual;
mod cash;
mod model;
mod product;
mod settings;
mod sync;

pub use settings::{Mp2DividendRates, SETTINGS_KEY as MP2_RATES_SETTINGS_KEY};

pub use accrual::{InterestPlan, PlannedActivity, PlannedAmendment, PlannedKind, PlannedRemoval};
pub use model::{
    build_idempotency_key, build_payout_idempotency_key, is_auto_interest_key,
    is_auto_interest_source, SOURCE_SYSTEM,
};
pub use product::{
    is_fixed_income_cash, mp2_maturity_date, parse_cash_product, parse_ymd, resolved_maturity_date,
    CashProduct, CashProductType, CreditFrequency, RateTier, YieldConfig,
    CASH_CATEGORY_FIXED_INCOME, MP2_GROUP,
};
pub use sync::{
    CashInterestAccountResult, CashInterestSyncResult, InterestAccrualService,
    InterestAccrualServiceTrait,
};
