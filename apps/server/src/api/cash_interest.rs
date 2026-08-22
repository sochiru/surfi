use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::{delete, get, post},
    Json, Router,
};
use wealthfolio_core::interest::{CashInterestSyncResult, Mp2DividendRates};

use crate::{error::ApiResult, main_lib::AppState};

async fn sync_cash_interest(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<CashInterestSyncResult>> {
    let result = state.interest_accrual_service.sync().await?;
    Ok(Json(result))
}

async fn sync_cash_interest_account(
    Path(account_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<CashInterestSyncResult>> {
    let result = state
        .interest_accrual_service
        .sync_account(&account_id)
        .await?;
    Ok(Json(result))
}

async fn remove_auto_interest(State(state): State<Arc<AppState>>) -> ApiResult<Json<usize>> {
    let n = state.interest_accrual_service.remove_auto_created().await?;
    Ok(Json(n))
}

async fn get_mp2_rates(State(state): State<Arc<AppState>>) -> ApiResult<Json<Mp2DividendRates>> {
    let rates = state.interest_accrual_service.get_mp2_rates()?;
    Ok(Json(rates))
}

async fn update_mp2_rates(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Mp2DividendRates>,
) -> ApiResult<Json<Mp2DividendRates>> {
    state
        .interest_accrual_service
        .set_mp2_rates(&payload)
        .await?;
    Ok(Json(payload))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/cash-interest/sync", post(sync_cash_interest))
        .route(
            "/cash-interest/sync/{account_id}",
            post(sync_cash_interest_account),
        )
        .route("/cash-interest/auto", delete(remove_auto_interest))
        .route(
            "/cash-interest/mp2-rates",
            get(get_mp2_rates).put(update_mp2_rates),
        )
}
