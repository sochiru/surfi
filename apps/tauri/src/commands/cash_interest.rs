use std::sync::Arc;

use crate::context::ServiceContext;
use log::debug;
use tauri::State;
use wealthfolio_core::interest::{CashInterestSyncResult, Mp2DividendRates};

#[tauri::command]
pub async fn sync_cash_interest(
    state: State<'_, Arc<ServiceContext>>,
) -> Result<CashInterestSyncResult, String> {
    debug!("Syncing cash interest accrual...");
    state
        .interest_accrual_service()
        .sync()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_cash_interest_account(
    account_id: String,
    state: State<'_, Arc<ServiceContext>>,
) -> Result<CashInterestSyncResult, String> {
    debug!("Syncing cash interest for account {account_id}...");
    state
        .interest_accrual_service()
        .sync_account(&account_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_mp2_rates(
    state: State<'_, Arc<ServiceContext>>,
) -> Result<Mp2DividendRates, String> {
    debug!("Fetching MP2 dividend rates...");
    state
        .interest_accrual_service()
        .get_mp2_rates()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_mp2_rates(
    rates: Mp2DividendRates,
    state: State<'_, Arc<ServiceContext>>,
) -> Result<Mp2DividendRates, String> {
    debug!("Updating MP2 dividend rates...");
    state
        .interest_accrual_service()
        .set_mp2_rates(&rates)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rates)
}

#[tauri::command]
pub async fn remove_auto_interest(state: State<'_, Arc<ServiceContext>>) -> Result<usize, String> {
    debug!("Removing auto-created interest activities...");
    state
        .interest_accrual_service()
        .remove_auto_created()
        .await
        .map_err(|e| e.to_string())
}
