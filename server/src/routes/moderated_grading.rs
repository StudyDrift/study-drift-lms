//! Plan 3.4 — provisional scores and moderator reconciliation.

use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::repos::course;
use crate::repos::course_grades;
use crate::repos::course_module_assignments;
use crate::repos::enrollment;
use crate::repos::grade_change_audit;
use crate::repos::moderated_grading as mod_repo;
use crate::repos::module_assignment_submissions;
use crate::repos::provisional_grades;
use crate::services::grading::standards as sbg_grading;
use crate::services::moderated_grading as mod_service;
use crate::state::AppState;

async fn resolve_course_id(state: &AppState, course_code: &str) -> Result<Uuid, AppError> {
    let Some(row) = course::get_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    Ok(row.id)
}

fn require_feature(state: &AppState) -> Result<(), AppError> {
    if !state.moderated_grading_enabled {
        return Err(AppError::NotFound);
    }
    Ok(())
}

async fn can_reconcile(
    pool: &sqlx::PgPool,
    course_code: &str,
    user_id: Uuid,
    moderator_id: Option<Uuid>,
) -> Result<bool, AppError> {
    if enrollment::user_is_course_creator(pool, course_code, user_id).await? {
        return Ok(true);
    }
    Ok(moderator_id == Some(user_id))
}

async fn assert_staff(pool: &sqlx::PgPool, course_code: &str, user_id: Uuid) -> Result<(), AppError> {
    if !enrollment::user_is_course_staff(pool, course_code, user_id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionalGradeOut {
    submission_id: Uuid,
    grader_id: Uuid,
    score: f64,
    submitted_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn list_provisional_grades_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    assert_staff(&state.pool, &course_code, user.user_id).await?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(asn) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if !asn.moderated_grading {
        return Err(AppError::NotFound);
    }

    let mut rows = provisional_grades::list_for_assignment(&state.pool, course_id, item_id).await?;
    let is_mod = can_reconcile(
        &state.pool,
        &course_code,
        user.user_id,
        asn.moderator_user_id,
    )
    .await?;
    if !is_mod {
        let is_grader = asn.provisional_grader_user_ids.contains(&user.user_id);
        if !is_grader {
            return Err(AppError::Forbidden);
        }
        rows.retain(|r| r.grader_id == user.user_id);
    }

    let out: Vec<ProvisionalGradeOut> = rows
        .into_iter()
        .map(|r| ProvisionalGradeOut {
            submission_id: r.submission_id,
            grader_id: r.grader_id,
            score: r.score,
            submitted_at: r.submitted_at,
        })
        .collect();

    Ok(Json(json!({ "provisionalGrades": out })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostProvisionalBody {
    score: f64,
}

async fn post_provisional_grade_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<PostProvisionalBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    assert_staff(&state.pool, &course_code, user.user_id).await?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(asn) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if !asn.moderated_grading {
        return Err(AppError::NotFound);
    }
    if !asn.provisional_grader_user_ids.contains(&user.user_id) {
        return Err(AppError::Forbidden);
    }
    if !body.score.is_finite() || body.score < 0.0 {
        return Err(AppError::invalid_input("Score must be a non-negative number."));
    }
    if let Some(m) = asn.points_worth {
        if m > 0 && body.score > m as f64 + 1e-6 {
            return Err(AppError::invalid_input(format!(
                "Score cannot exceed {} points for this assignment.",
                m
            )));
        }
    }

    let Some(sub) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if sub.module_item_id != item_id {
        return Err(AppError::NotFound);
    }

    let row = provisional_grades::upsert(
        &state.pool,
        submission_id,
        user.user_id,
        body.score,
        None,
    )
    .await?;

    grade_change_audit::insert(
        &state.pool,
        course_id,
        item_id,
        sub.submitted_by,
        Some(user.user_id),
        "provisional_grade",
        &json!({
            "submissionId": submission_id,
            "graderId": user.user_id,
            "score": body.score,
        }),
    )
    .await?;

    Ok(Json(json!({
        "ok": true,
        "submissionId": row.submission_id,
        "graderId": row.grader_id,
        "score": row.score,
        "submittedAt": row.submitted_at,
    })))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReconciliationRowOut {
    submission_id: Uuid,
    student_user_id: Uuid,
    provisional: Vec<ProvisionalGradeOut>,
    flagged: bool,
    points_worth: Option<i32>,
    final_score: Option<f64>,
    reconciliation_source: Option<String>,
}

async fn get_reconciliation_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(asn) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if !asn.moderated_grading {
        return Err(AppError::NotFound);
    }
    if !can_reconcile(
        &state.pool,
        &course_code,
        user.user_id,
        asn.moderator_user_id,
    )
    .await?
    {
        return Err(AppError::Forbidden);
    }

    let subs =
        module_assignment_submissions::list_for_assignment(&state.pool, course_id, item_id, module_assignment_submissions::GradedFilter::All).await?;
    let all_pg = provisional_grades::list_for_assignment(&state.pool, course_id, item_id).await?;
    let mut by_sub: HashMap<Uuid, Vec<&crate::repos::provisional_grades::ProvisionalGradeRow>> =
        HashMap::new();
    for r in &all_pg {
        by_sub.entry(r.submission_id).or_default().push(r);
    }

    let (grades_map, _, _) = course_grades::list_for_course(&state.pool, course_id).await?;

    let mut rows: Vec<ReconciliationRowOut> = Vec::new();
    for s in subs {
        let pv: Vec<ProvisionalGradeOut> = by_sub
            .get(&s.id)
            .map(|v| {
                v.iter()
                    .map(|r| ProvisionalGradeOut {
                        submission_id: r.submission_id,
                        grader_id: r.grader_id,
                        score: r.score,
                        submitted_at: r.submitted_at,
                    })
                    .collect()
            })
            .unwrap_or_default();

        let (mn, mx) = pv
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| {
                (a.min(p.score), b.max(p.score))
            });
        let flagged = pv.len() >= 2
            && mod_service::provisional_scores_exceed_threshold(mn, mx, asn.points_worth, asn.moderation_threshold_pct);

        let final_score = grades_map
            .get(&s.submitted_by)
            .and_then(|m| m.get(&item_id))
            .and_then(|cell| cell.parse::<f64>().ok());

        let recon_source: Option<String> = sqlx::query_scalar(&format!(
            r#"SELECT reconciliation_source FROM {} WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3"#,
            crate::db::schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(s.submitted_by)
        .bind(item_id)
        .fetch_optional(&state.pool)
        .await?
        .flatten();

        rows.push(ReconciliationRowOut {
            submission_id: s.id,
            student_user_id: s.submitted_by,
            provisional: pv,
            flagged,
            points_worth: asn.points_worth,
            final_score,
            reconciliation_source: recon_source,
        });
    }

    let unreconciled_flagged = mod_repo::count_flagged_unreconciled(
        &state.pool,
        course_id,
        item_id,
        asn.points_worth.unwrap_or(100).max(1),
        asn.moderation_threshold_pct,
    )
    .await?;

    Ok(Json(json!({
        "rows": rows,
        "unreconciledFlaggedCount": unreconciled_flagged,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReconcileBody {
    /// `accept_grader` | `average` | `override` | `single`
    action: String,
    #[serde(default)]
    grader_id: Option<Uuid>,
    #[serde(default)]
    override_score: Option<f64>,
}

async fn post_reconcile_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<ReconcileBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(asn) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if !asn.moderated_grading {
        return Err(AppError::NotFound);
    }
    if !can_reconcile(
        &state.pool,
        &course_code,
        user.user_id,
        asn.moderator_user_id,
    )
    .await?
    {
        return Err(AppError::Forbidden);
    }

    let Some(sub) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if sub.module_item_id != item_id {
        return Err(AppError::NotFound);
    }

    let prov = provisional_grades::list_for_submission(&state.pool, course_id, submission_id).await?;
    if prov.is_empty() {
        return Err(AppError::invalid_input(
            "No provisional grades exist for this submission yet.",
        ));
    }

    let max_pts = asn.points_worth.unwrap_or(0).max(0) as f64;

    let (points, source, picked_grader): (f64, &str, Option<Uuid>) = match body.action.as_str() {
        "accept_grader" => {
            let Some(gid) = body.grader_id else {
                return Err(AppError::invalid_input(
                    "graderId is required for accept_grader.",
                ));
            };
            let Some(p) = prov.iter().find(|x| x.grader_id == gid) else {
                return Err(AppError::invalid_input(
                    "That grader has not submitted a provisional score for this submission.",
                ));
            };
            (p.score, "grader", Some(gid))
        }
        "average" => {
            let sum: f64 = prov.iter().map(|p| p.score).sum();
            let n = prov.len() as f64;
            (sum / n, "average", None)
        }
        "override" => {
            let Some(s) = body.override_score else {
                return Err(AppError::invalid_input(
                    "overrideScore is required for override.",
                ));
            };
            if !s.is_finite() || s < 0.0 {
                return Err(AppError::invalid_input("overrideScore must be non-negative."));
            }
            if max_pts > 0.0 && s > max_pts + 1e-6 {
                return Err(AppError::invalid_input(format!(
                    "overrideScore cannot exceed {} points.",
                    asn.points_worth.unwrap_or(0)
                )));
            }
            (s, "override", None)
        }
        "single" => {
            if prov.len() != 1 {
                return Err(AppError::invalid_input(
                    "single action requires exactly one provisional grade.",
                ));
            };
            (prov[0].score, "single", None)
        }
        _ => {
            return Err(AppError::invalid_input(
                "action must be accept_grader, average, override, or single.",
            ));
        }
    };

    let now = Utc::now();
    course_grades::upsert_reconciled_final(
        &state.pool,
        course_id,
        sub.submitted_by,
        item_id,
        points,
        None,
        source,
        picked_grader,
        user.user_id,
        now,
    )
    .await?;
    if let Some(c) = course::get_by_id(&state.pool, course_id).await? {
        if c.sbg_enabled {
            let _ = sbg_grading::recompute_student_sbg(
                &state.pool,
                course_id,
                sub.submitted_by,
                false,
            )
            .await;
        }
    }

    grade_change_audit::insert(
        &state.pool,
        course_id,
        item_id,
        sub.submitted_by,
        Some(user.user_id),
        "reconciliation",
        &json!({
            "submissionId": submission_id,
            "source": source,
            "graderId": picked_grader,
            "points": points,
            "action": body.action,
        }),
    )
    .await?;

    tracing::info!(
        target: "moderated_grading",
        course_code = %course_code,
        item_id = %item_id,
        submission_id = %submission_id,
        moderator_id = %user.user_id,
        reconciliation_source = source,
        "reconciliation_completed"
    );

    Ok(Json(json!({
        "ok": true,
        "studentUserId": sub.submitted_by,
        "pointsEarned": points,
        "reconciliationSource": source,
        "reconciledGraderId": picked_grader,
        "reconciledAt": now,
    })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/provisional-grades",
            get(list_provisional_grades_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/provisional-grades",
            post(post_provisional_grade_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/reconciliation",
            get(get_reconciliation_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/reconcile",
            post(post_reconcile_handler),
        )
}
