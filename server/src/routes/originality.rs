use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use rust_decimal::Decimal;
use serde::Serialize;
use serde_json::json;
use sha2::Sha256;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::repos::course;
use crate::repos::course_grades;
use crate::repos::course_module_assignments;
use crate::repos::enrollment;
use crate::repos::module_assignment_submissions;
use crate::repos::originality_platform_config;
use crate::repos::originality_reports;
use crate::services::originality::storage;
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/originality",
            get(get_submission_originality_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/originality/embed-url",
            get(get_originality_embed_url_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/originality/summary",
            get(get_submission_originality_summary_handler),
        )
        .route(
            "/api/v1/webhooks/originality/{provider}",
            post(webhook_originality_handler),
        )
}

async fn resolve_course_id(state: &AppState, course_code: &str) -> Result<Uuid, AppError> {
    let Some(row) = course::get_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    Ok(row.id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OriginalityReportOut {
    provider: String,
    status: String,
    similarity_pct: Option<f64>,
    ai_probability: Option<f64>,
    report_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    report_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

fn decimal_to_f64(d: Option<Decimal>) -> Option<f64> {
    d.and_then(|x| x.to_string().parse::<f64>().ok())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OriginalitySummaryOut {
    provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    similarity_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ai_probability: Option<f64>,
    /// RFC3339 from the report `updated_at` (detection / last refresh).
    #[serde(skip_serializing_if = "Option::is_none")]
    detected_at: Option<String>,
    /// True when a third-party full-report embed or deep link is not being returned.
    full_report_unavailable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    full_report_unavailable_message: Option<String>,
}

fn has_http_embed(r: &originality_reports::OriginalityReportRow) -> bool {
    r.report_url
        .as_deref()
        .map(str::trim)
        .map(|s| s.starts_with("http://") || s.starts_with("https://"))
        .unwrap_or(false)
}

fn virtual_embed_path(r: &originality_reports::OriginalityReportRow) -> Option<String> {
    r.report_token
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .map(|t| format!("/embed?token={}", urlencoding::encode(t)))
}

fn build_summary_from_row(
    r: &originality_reports::OriginalityReportRow,
    full_report_unavailable: bool,
) -> OriginalitySummaryOut {
    OriginalitySummaryOut {
        provider: r.provider.clone(),
        similarity_pct: decimal_to_f64(r.similarity_pct),
        ai_probability: decimal_to_f64(r.ai_probability),
        detected_at: Some(r.updated_at.to_rfc3339()),
        full_report_unavailable,
        full_report_unavailable_message: if full_report_unavailable {
            Some(
                "Full report is unavailable in an embedded view — the provider link or embed token may have expired. Stored scores below reflect the detection run on file."
                    .to_string(),
            )
        } else {
            None
        },
    }
}

async fn get_submission_originality_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    if !state.originality_detection_enabled {
        return Err(AppError::NotFound);
    }
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(sub) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if sub.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    if !staff && sub.submitted_by != user.user_id {
        return Err(AppError::Forbidden);
    }

    let asn = course_module_assignments::get_for_course_item(&state.pool, course_id, item_id)
        .await?
        .ok_or(AppError::NotFound)?;

    if !staff {
        match asn.originality_student_visibility.as_str() {
            "hide" => {
                return Ok(Json(serde_json::json!({ "reports": [] })));
            }
            "show_after_grading" => {
                let graded = course_grades::row_exists(
                    &state.pool,
                    course_id,
                    sub.submitted_by,
                    item_id,
                )
                .await?;
                if !graded {
                    return Ok(Json(serde_json::json!({ "reports": [] })));
                }
            }
            "show" | _ => {}
        }
    }

    let rows = originality_reports::list_for_submission(&state.pool, submission_id).await?;
    let reports: Vec<OriginalityReportOut> = rows
        .into_iter()
        .map(|r| OriginalityReportOut {
            provider: r.provider,
            status: r.status,
            similarity_pct: decimal_to_f64(r.similarity_pct),
            ai_probability: decimal_to_f64(r.ai_probability),
            report_url: r.report_url,
            report_token: if staff {
                r.report_token
            } else {
                None
            },
            error_message: r.error_message,
        })
        .collect();

    Ok(Json(serde_json::json!({ "reports": reports })))
}

fn resolve_embed_path(r: &originality_reports::OriginalityReportRow) -> Option<String> {
    if has_http_embed(r) {
        return r.report_url.clone();
    }
    virtual_embed_path(r)
}

async fn embed_summary_enriched(
    state: &AppState,
    course_code: &str,
    r: &originality_reports::OriginalityReportRow,
    base: OriginalitySummaryOut,
) -> OriginalitySummaryOut {
    let key = r.report_storage_key.as_deref();
    if key.is_none() {
        return base;
    }
    if let Ok(v) =
        storage::read_stored_json_summary(&state.course_files_root, course_code, key.unwrap())
            .await
    {
        let mut o = base;
        if o.similarity_pct.is_none() {
            if let Some(f) = v
                .get("similarityPct")
                .or_else(|| v.get("similarity_pct"))
                .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            {
                o.similarity_pct = Some(f);
            }
        }
        if o.ai_probability.is_none() {
            if let Some(f) = v
                .get("aiProbability")
                .or_else(|| v.get("ai_probability"))
                .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            {
                o.ai_probability = Some(f);
            }
        }
        return o;
    }
    base
}

async fn get_originality_embed_url_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    if !state.originality_detection_enabled {
        return Err(AppError::NotFound);
    }
    let user = auth_user(&state, &headers)?;
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    if !staff {
        return Err(AppError::Forbidden);
    }
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(sub) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if sub.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    let rows = originality_reports::list_for_submission(&state.pool, submission_id).await?;
    let Some(r) = rows.iter().find(|r| r.status == "done") else {
        return Err(AppError::invalid_input(
            "No finished originality report is available yet for this submission.",
        ));
    };
    let embed = resolve_embed_path(r);
    let can_fallback = r.similarity_pct.is_some()
        || r.ai_probability.is_some()
        || r.report_storage_key.is_some();
    if embed.is_none() && !can_fallback {
        return Err(AppError::invalid_input(
            "No originality report URL is available yet for this submission.",
        ));
    }
    let summary_needs_unavailable = embed.is_none() && can_fallback;
    let base = build_summary_from_row(r, summary_needs_unavailable);
    let summary = embed_summary_enriched(&state, &course_code, r, base).await;
    Ok(Json(json!({ "embedUrl": embed, "summary": summary })))
}

/// Stored-report summary; same visibility as `GET /originality` (course policy + own submission for learners).
async fn get_submission_originality_summary_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    if !state.originality_detection_enabled {
        return Err(AppError::NotFound);
    }
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(sub) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if sub.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    if !staff && sub.submitted_by != user.user_id {
        return Err(AppError::Forbidden);
    }

    let asn = course_module_assignments::get_for_course_item(&state.pool, course_id, item_id)
        .await?
        .ok_or(AppError::NotFound)?;

    if !staff {
        match asn.originality_student_visibility.as_str() {
            "hide" => {
                return Err(AppError::Forbidden);
            }
            "show_after_grading" => {
                let graded = course_grades::row_exists(
                    &state.pool,
                    course_id,
                    sub.submitted_by,
                    item_id,
                )
                .await?;
                if !graded {
                    return Err(AppError::Forbidden);
                }
            }
            "show" | _ => {}
        }
    }

    let rows = originality_reports::list_for_submission(&state.pool, submission_id).await?;
    let Some(r) = rows
        .iter()
        .find(|r| {
            r.status == "done"
                && (r.similarity_pct.is_some()
                    || r.ai_probability.is_some()
                    || r.report_storage_key.is_some())
        })
    else {
        return Err(AppError::NotFound);
    };
    let base = build_summary_from_row(r, true);
    let summary = embed_summary_enriched(&state, &course_code, r, base).await;
    Ok(Json(json!({ "summary": summary })))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebhookBody {
    provider_report_id: String,
    #[serde(default)]
    similarity_pct: Option<f64>,
    #[serde(default)]
    report_url: Option<String>,
    #[serde(default)]
    report_token: Option<String>,
}

async fn webhook_originality_handler(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    if !state.originality_detection_enabled {
        return Err(AppError::NotFound);
    }
    let cfg = originality_platform_config::get_singleton(&state.pool).await?;
    let Some(secret) = cfg.webhook_hmac_secret.as_deref().filter(|s| !s.trim().is_empty()) else {
        return Err(AppError::Forbidden);
    };
    let sig_header = headers
        .get("x-originality-signature")
        .or_else(|| headers.get("X-Originality-Signature"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expected = compute_hmac_hex(secret.as_bytes(), body.as_ref());
    let ok = constant_time_hex_eq(sig_header, &expected);
    if !ok {
        return Err(AppError::Forbidden);
    }

    let full_raw: serde_json::Value = serde_json::from_slice(body.as_ref())
        .map_err(|_| AppError::invalid_input("Invalid webhook JSON."))?;
    let parsed: WebhookBody = serde_json::from_slice(body.as_ref())
        .map_err(|_| AppError::invalid_input("Invalid webhook JSON (expected providerReportId)."))?;
    let sim = parsed
        .similarity_pct
        .map(|v| Decimal::try_from(v).unwrap_or(Decimal::ZERO));

    let p = provider.trim();
    if p.is_empty() {
        return Err(AppError::invalid_input("Missing provider in path."));
    }

    let updated = originality_reports::mark_done_by_provider_report(
        &state.pool,
        p,
        &parsed.provider_report_id,
        sim,
        parsed.report_url.as_deref(),
        parsed.report_token.as_deref(),
    )
    .await?;
    if updated.is_empty() {
        return Err(AppError::NotFound);
    }
    for (report_id, submission_id) in updated {
        let Some(sub) = module_assignment_submissions::get_by_id(&state.pool, submission_id).await? else {
            continue;
        };
        let Some(crow) = course::get_by_id(&state.pool, sub.course_id).await? else {
            continue;
        };
        let text = match storage::read_submission_file_plain(
            &state.pool,
            &state.course_files_root,
            &crow.course_code,
            &sub,
        )
        .await
        {
            Ok(s) => storage::cap_submission_text_for_storage(&s),
            Err(_) => String::new(),
        };
        let payload = json!({
            "version": 1i32,
            "kind": "webhook_ingest",
            "provider": p,
            "webhook": full_raw,
            "textSnapshot": text,
        });
        storage::best_effort_store_from_parts(
            &state.pool,
            &state.course_files_root,
            sub.course_id,
            report_id,
            submission_id,
            p,
            payload,
        )
        .await;
    }
    Ok(StatusCode::NO_CONTENT)
}

fn compute_hmac_hex(secret: &[u8], body: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC key length");
    mac.update(body);
    format!("sha256={}", bytes_to_hex_lower(&mac.finalize().into_bytes()))
}

fn bytes_to_hex_lower(bytes: &[u8]) -> String {
    bytes
        .iter()
        .flat_map(|b| [b >> 4, b & 0xf])
        .map(|n| char::from_digit(n as u32, 16).unwrap_or('0'))
        .collect()
}

fn constant_time_hex_eq(header: &str, expected_with_prefix: &str) -> bool {
    let h = header.trim().to_ascii_lowercase();
    let e = expected_with_prefix.trim().to_ascii_lowercase();
    if h.len() != e.len() {
        return false;
    }
    h.bytes().zip(e.bytes()).all(|(a, b)| a == b)
}
