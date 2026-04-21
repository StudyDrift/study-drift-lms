//! Admin-only maintenance endpoints.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::require_permission;
use crate::services::irt_calibration_job;
use crate::state::AppState;

const PERM_RBAC_MANAGE: &str = "global:app:rbac:manage";

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/v1/admin/jobs/irt-calibrate",
        post(post_irt_calibrate_handler),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IrtCalibrateRequest {
    #[serde(default)]
    concept_id: Option<Uuid>,
}

async fn post_irt_calibrate_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<IrtCalibrateRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let _auth = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;

    let pool = state.pool.clone();
    let concept_id = body.concept_id;
    let job_id = Uuid::new_v4();
    tokio::spawn(async move {
        match irt_calibration_job::run_irt_calibration(&pool, concept_id).await {
            Ok((calibrated, examined)) => {
                tracing::info!(
                    target: "irt.calibration",
                    %job_id,
                    calibrated,
                    examined,
                    "irt.calibration_job_finished"
                );
            }
            Err(e) => {
                tracing::error!(target: "irt.calibration", %job_id, error = %e, "irt.calibration_job_failed");
            }
        }
    });

    Ok((StatusCode::ACCEPTED, Json(json!({ "jobId": job_id }))))
}
