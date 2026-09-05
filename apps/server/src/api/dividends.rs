use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::{delete, get, post},
    Json, Router,
};
use wealthfolio_core::dividends::{
    AssetDividendView, DividendCalendarEvent, DividendSyncResult, DividendSyncSettings,
};

use crate::{error::ApiResult, main_lib::AppState};

async fn get_dividend_sync_settings(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<DividendSyncSettings>> {
    let settings = state.dividend_sync_service.get_settings()?;
    Ok(Json(settings))
}

async fn update_dividend_sync_settings(
    State(state): State<Arc<AppState>>,
    Json(settings): Json<DividendSyncSettings>,
) -> ApiResult<Json<DividendSyncSettings>> {
    let updated = state
        .dividend_sync_service
        .update_settings(settings)
        .await?;
    Ok(Json(updated))
}

async fn sync_dividends(State(state): State<Arc<AppState>>) -> ApiResult<Json<DividendSyncResult>> {
    let result = state.dividend_sync_service.sync().await?;
    Ok(Json(result))
}

async fn sync_dividends_account(
    Path(account_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<DividendSyncResult>> {
    let result = state
        .dividend_sync_service
        .sync_account(&account_id)
        .await?;
    Ok(Json(result))
}

async fn remove_auto_dividends(State(state): State<Arc<AppState>>) -> ApiResult<Json<usize>> {
    let n = state.dividend_sync_service.remove_auto_created().await?;
    Ok(Json(n))
}

async fn remove_auto_dividends_account(
    Path(account_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<usize>> {
    let n = state
        .dividend_sync_service
        .remove_auto_created_account(&account_id)
        .await?;
    Ok(Json(n))
}

async fn get_dividend_calendar_events(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<Vec<DividendCalendarEvent>>> {
    let events = state.dividend_sync_service.build_calendar_events().await?;
    Ok(Json(events))
}

async fn get_asset_dividend_view(
    Path(asset_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<AssetDividendView>> {
    let view = state
        .dividend_sync_service
        .build_asset_dividend_view(&asset_id)
        .await?;
    Ok(Json(view))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/dividends/settings",
            get(get_dividend_sync_settings).put(update_dividend_sync_settings),
        )
        .route("/dividends/sync", post(sync_dividends))
        .route("/dividends/sync/{account_id}", post(sync_dividends_account))
        .route("/dividends/auto", delete(remove_auto_dividends))
        .route(
            "/dividends/auto/{account_id}",
            delete(remove_auto_dividends_account),
        )
        .route("/dividends/calendar", get(get_dividend_calendar_events))
        .route("/dividends/assets/{asset_id}", get(get_asset_dividend_view))
}
