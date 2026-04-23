//! Admin-only maintenance endpoints.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::require_permission;
use crate::repos::originality_platform_config;
use crate::repos::originality_reports;
use crate::services::irt_calibration_job;
use crate::state::AppState;

const PERM_RBAC_MANAGE: &str = "global:app:rbac:manage";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/admin/jobs/irt-calibrate",
            post(post_irt_calibrate_handler),
        )
        .route(
            "/api/v1/admin/originality-config",
            put(put_originality_config_handler),
        )
        .route(
            "/api/v1/admin/users/{user_id}/dsar-export",
            get(get_user_dsar_export_handler),
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutOriginalityConfigRequest {
    #[serde(default)]
    dpa_accepted_at: Option<DateTime<Utc>>,
    active_external_provider: String,
    #[serde(default)]
    provider_api_key: Option<String>,
    #[serde(default)]
    webhook_hmac_secret: Option<String>,
    #[serde(default)]
    similarity_amber_min_pct: Option<i32>,
    #[serde(default)]
    similarity_red_min_pct: Option<i32>,
    #[serde(default)]
    ai_amber_min_pct: Option<i32>,
    #[serde(default)]
    ai_red_min_pct: Option<i32>,
}

fn pct_to_dec(v: Option<i32>, default: i32) -> Decimal {
    let n = v.unwrap_or(default).clamp(0, 100);
    Decimal::from(n)
}

async fn put_originality_config_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PutOriginalityConfigRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _auth = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;

    let p = body.active_external_provider.trim().to_ascii_lowercase();
    if !matches!(
        p.as_str(),
        "none" | "turnitin" | "copyleaks" | "gptzero"
    ) {
        return Err(AppError::invalid_input(
            "activeExternalProvider must be none, turnitin, copyleaks, or gptzero.",
        ));
    }

    let write = originality_platform_config::OriginalityPlatformConfigWrite {
        dpa_accepted_at: body.dpa_accepted_at,
        active_external_provider: p,
        provider_api_key: body.provider_api_key,
        webhook_hmac_secret: body.webhook_hmac_secret,
        similarity_amber_min_pct: pct_to_dec(body.similarity_amber_min_pct, 25),
        similarity_red_min_pct: pct_to_dec(body.similarity_red_min_pct, 50),
        ai_amber_min_pct: pct_to_dec(body.ai_amber_min_pct, 25),
        ai_red_min_pct: pct_to_dec(body.ai_red_min_pct, 50),
    };
    originality_platform_config::upsert_singleton(&state.pool, &write).await?;
    Ok(Json(json!({ "ok": true })))
}

/// FERPA-oriented export slice: includes per-submission originality report metadata (plan 3.14).
async fn get_user_dsar_export_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _auth = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;

    let rows = originality_reports::list_for_user_ferpa(&state.pool, user_id).await?;
    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "reportId": r.report_id,
                "submissionId": r.submission_id,
                "courseCode": r.course_code,
                "moduleItemId": r.module_item_id,
                "provider": r.provider,
                "status": r.status,
                "similarityPct": r.similarity_pct.as_ref().and_then(|d| d.to_f64()),
                "aiProbability": r.ai_probability.as_ref().and_then(|d| d.to_f64()),
                "reportDate": r.updated_at.to_rfc3339(),
            })
        })
        .collect();
    Ok(Json(
        json!({ "userId": user_id, "originalityReports": items, "version": 1, "exportKind": "ferpa-slice" }),
    ))
}
