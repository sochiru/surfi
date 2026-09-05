use std::sync::Arc;

use crate::context::ServiceContext;
use log::debug;
use tauri::State;
use wealthfolio_core::dividends::{
    AssetDividendView, DividendCalendarEvent, DividendSyncResult, DividendSyncSettings,
};

#[tauri::command]
pub async fn get_dividend_sync_settings(
    state: State<'_, Arc<ServiceContext>>,
) -> Result<DividendSyncSettings, String> {
    debug!("Fetching dividend sync settings...");
    state
        .dividend_sync_service()
        .get_settings()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_dividend_sync_settings(
    settings: DividendSyncSettings,
    state: State<'_, Arc<ServiceContext>>,
) -> Result<DividendSyncSettings, String> {
    debug!("Updating dividend sync settings...");
    state
        .dividend_sync_service()
        .update_settings(settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_dividends(
    state: State<'_, Arc<ServiceContext>>,
) -> Result<DividendSyncResult, String> {
    debug!("Syncing market-data dividends...");
    state
        .dividend_sync_service()
        .sync()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_dividends_account(
    account_id: String,
    state: State<'_, Arc<ServiceContext>>,
) -> Result<DividendSyncResult, String> {
    debug!("Syncing market-data dividends for {}...", account_id);
    state
        .dividend_sync_service()
        .sync_account(&account_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_auto_dividends(state: State<'_, Arc<ServiceContext>>) -> Result<usize, String> {
    debug!("Removing auto-created dividends...");
    state
        .dividend_sync_service()
        .remove_auto_created()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_auto_dividends_account(
    account_id: String,
    state: State<'_, Arc<ServiceContext>>,
) -> Result<usize, String> {
    debug!("Removing auto-created dividends for {}...", account_id);
    state
        .dividend_sync_service()
        .remove_auto_created_account(&account_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_dividend_calendar_events(
    state: State<'_, Arc<ServiceContext>>,
) -> Result<Vec<DividendCalendarEvent>, String> {
    debug!("Building dividend calendar events...");
    state
        .dividend_sync_service()
        .build_calendar_events()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_asset_dividend_view(
    asset_id: String,
    state: State<'_, Arc<ServiceContext>>,
) -> Result<AssetDividendView, String> {
    debug!("Building asset dividend view for {}...", asset_id);
    state
        .dividend_sync_service()
        .build_asset_dividend_view(&asset_id)
        .await
        .map_err(|e| e.to_string())
}
