//! SBG HTTP API (plan 3.7): standards import, alignments, gradebook, mastery transcript.

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::Path;
use axum::http::header;
use axum::body::Body;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::models::sbg::{
    SbgGradebookCell, SbgGradebookStudent, SbgItemAlignmentsPut, SbgMasteryTranscriptResponse,
    SbgMasteryTranscriptRow, SbgStandardPublic, SbgStandardsGradebookResponse, SbgStandardsListResponse,
};
use crate::repos::course;
use crate::repos::enrollment;
use crate::repos::sbg;
use crate::services::grading::standards as sbg_grading;
use crate::services::mastery_transcript_pdf;
use crate::state::AppState;
use axum::extract::State;
use axum::http::HeaderMap;

async fn require_course_access(
    state: &AppState,
    course_code: &str,
    user_id: Uuid,
) -> Result<(), AppError> {
    let ok = enrollment::user_has_access(&state.pool, course_code, user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Naive CSV: header row `standard_id,description,subject,grade_level` (optional columns), no commas in cells.
fn parse_standards_csv_simple(
    bytes: &[u8],
) -> Result<Vec<(Option<String>, String, Option<String>, Option<String>, i32)>, AppError> {
    let text = String::from_utf8_lossy(bytes);
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if lines.len() < 2 {
        return Err(AppError::invalid_input("CSV must include a header and at least one data row."));
    }
    let head: Vec<String> = lines[0]
        .split(',')
        .map(|c| c.trim().to_lowercase().replace(' ', ""))
        .collect();
    let mut out = Vec::new();
    for (pos, line) in lines.iter().skip(1).enumerate() {
        let cells: Vec<String> = line
            .splitn(head.len().max(2), ',')
            .map(|c| c.trim().to_string())
            .collect();
        let mut ext: Option<String> = None;
        let mut desc = String::new();
        let mut sub: Option<String> = None;
        let mut gr: Option<String> = None;
        for (i, h) in head.iter().enumerate() {
            let f = cells.get(i).map(String::as_str).unwrap_or("").trim();
            match h.as_str() {
                "standard_id" => {
                    if !f.is_empty() {
                        ext = Some(f.to_string());
                    }
                }
                "description" => desc = f.to_string(),
                "subject" => {
                    if !f.is_empty() {
                        sub = Some(f.to_string());
                    }
                }
                "grade_level" | "gradelevel" => {
                    if !f.is_empty() {
                        gr = Some(f.to_string());
                    }
                }
                _ => {}
            }
        }
        if desc.is_empty() {
            continue;
        }
        out.push((ext, desc, sub, gr, pos as i32));
    }
    if out.is_empty() {
        return Err(AppError::invalid_input("No data rows with a description column."));
    }
    Ok(out)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/standards/import",
            post(standards_import_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/standards",
            get(standards_list_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/standards-gradebook",
            get(standards_gradebook_get_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/students/{user_id}/mastery-transcript",
            get(mastery_transcript_get_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/students/{user_id}/mastery-transcript.pdf",
            get(mastery_transcript_pdf_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/module-items/{item_id}/sbg-alignments",
            put(item_alignments_put_handler),
        )
}

async fn standards_import_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = crate::repos::course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let c = course::get_by_id(&state.pool, course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !c.sbg_enabled {
        return Err(AppError::invalid_input(
            "Enable standards-based grading in Grading & scoring before importing standards.",
        ));
    }
    let rows = parse_standards_csv_simple(&body)?;
    sbg::import_course_standards_replace(&state.pool, course_id, &rows).await?;
    sbg_grading::recompute_course_sbg(&state.pool, course_id, &course_code).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn standards_list_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<SbgStandardsListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let c = course::get_by_id(&state.pool, course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !c.sbg_enabled {
        return Err(AppError::Forbidden);
    }
    let rows = sbg::list_course_standards(&state.pool, course_id).await?;
    let standards: Vec<SbgStandardPublic> = rows
        .into_iter()
        .map(|r| SbgStandardPublic {
            id: r.id,
            external_id: r.external_id,
            description: r.description,
            subject: r.subject,
            grade_level: r.grade_level,
            position: r.sort_order,
        })
        .collect();
    Ok(Json(SbgStandardsListResponse { standards }))
}

async fn standards_gradebook_get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<SbgStandardsGradebookResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let perms = crate::repos::course_grants::course_gradebook_view_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &perms).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let c = course::get_by_id(&state.pool, course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !c.sbg_enabled {
        return Err(AppError::invalid_input(
            "Standards gradebook requires SBG to be enabled for this course.",
        ));
    }
    let st = sbg::list_course_standards(&state.pool, course_id).await?;
    let stds: Vec<SbgStandardPublic> = st
        .iter()
        .map(|r| SbgStandardPublic {
            id: r.id,
            external_id: r.external_id.clone(),
            description: r.description.clone(),
            subject: r.subject.clone(),
            grade_level: r.grade_level.clone(),
            position: r.sort_order,
        })
        .collect();
    let roster = enrollment::list_student_users_for_course_code(&state.pool, &course_code).await?;
    let prof = sbg::list_proficiency_matrix(&state.pool, course_id).await?;
    let mut lab_map: HashMap<(Uuid, Uuid), String> = HashMap::new();
    for p in prof {
        let l = p.level_label.clone().unwrap_or_else(|| "—".to_string());
        lab_map.insert((p.student_id, p.standard_id), l);
    }
    let students: Vec<SbgGradebookStudent> = roster
        .into_iter()
        .map(|(uid, label)| SbgGradebookStudent {
            user_id: uid,
            display_label: label,
        })
        .collect();
    let mut proficiencies: Vec<SbgGradebookCell> = Vec::new();
    for srow in &st {
        for u in &students {
            let key = (u.user_id, srow.id);
            let level_label = lab_map
                .get(&key)
                .cloned()
                .unwrap_or_else(|| "—".to_string());
            proficiencies.push(SbgGradebookCell {
                student_user_id: u.user_id,
                standard_id: srow.id,
                level_label,
            });
        }
    }
    Ok(Json(SbgStandardsGradebookResponse {
        standards: stds,
        students,
        proficiencies,
    }))
}

async fn mastery_transcript_get_handler(
    State(state): State<AppState>,
    Path((course_code, user_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<SbgMasteryTranscriptResponse>, AppError> {
    let j = build_mastery_transcript_inner(&state, &course_code, user_id, &headers).await?;
    Ok(Json(j))
}

async fn mastery_transcript_pdf_handler(
    State(state): State<AppState>,
    Path((course_code, user_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let j = build_mastery_transcript_inner(&state, &course_code, user_id, &headers).await?;
    let student_label = crate::repos::enrollment::list_student_users_for_course_code(
        &state.pool,
        &j.course_code,
    )
    .await?
    .into_iter()
    .find(|(u, _)| *u == user_id)
    .map(|(_, s)| s)
    .unwrap_or_else(|| format!("{user_id}"));
    let lines: Vec<(String, String)> = j
        .rows
        .iter()
        .map(|r| (r.external_id.clone().unwrap_or_default(), r.level_label.clone()))
        .collect();
    let pdf = mastery_transcript_pdf::build_mastery_transcript_pdf(
        &j.course_title,
        &j.course_code,
        &student_label,
        &lines,
    )
    .map_err(|e| {
        AppError::invalid_input(format!("Could not build PDF: {e}"))
    })?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"mastery-transcript.pdf\"",
        )
        .body(Body::from(pdf))
        .map_err(|e| AppError::invalid_input(e.to_string()))
}

async fn build_mastery_transcript_inner(
    state: &AppState,
    course_code: &str,
    user_id: Uuid,
    headers: &HeaderMap,
) -> Result<SbgMasteryTranscriptResponse, AppError> {
    let me = auth_user(state, headers)?;
    require_course_access(state, course_code, me.user_id).await?;
    if me.user_id != user_id {
        let perms = crate::repos::course_grants::course_gradebook_view_permission(course_code);
        assert_permission(&state.pool, me.user_id, &perms).await?;
    }
    let Some(course_id) = course::get_id_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    let c = course::get_by_id(&state.pool, course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !c.sbg_enabled {
        return Err(AppError::invalid_input("Mastery transcript requires SBG for this course."));
    }
    sbg_grading::recompute_student_sbg(
        &state.pool,
        course_id,
        user_id,
        me.user_id == user_id,
    )
    .await?;
    let st = sbg::list_course_standards(&state.pool, course_id).await?;
    let prows = sbg::list_proficiency_for_student(&state.pool, course_id, user_id).await?;
    let pmap: HashMap<Uuid, _> = prows.into_iter().map(|p| (p.standard_id, p)).collect();
    let rows: Vec<SbgMasteryTranscriptRow> = st
        .iter()
        .map(|r| {
            let p = pmap.get(&r.id);
            SbgMasteryTranscriptRow {
                standard_id: r.id,
                external_id: r.external_id.clone(),
                description: r.description.clone(),
                proficiency: p.and_then(|x| x.proficiency),
                level_label: p
                    .and_then(|x| x.level_label.clone())
                    .unwrap_or_else(|| "—".into()),
                last_assessed: p.and_then(|x| x.last_assessed),
            }
        })
        .collect();
    Ok(SbgMasteryTranscriptResponse {
        course_title: c.title,
        course_code: c.course_code,
        student_user_id: user_id,
        rows,
    })
}

async fn item_alignments_put_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<SbgItemAlignmentsPut>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let can = crate::repos::course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &can).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let c = course::get_by_id(&state.pool, course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !c.sbg_enabled {
        return Err(AppError::invalid_input("SBG is not enabled for this course."));
    }
    let mut rows: Vec<(Uuid, Uuid, String, f64)> = Vec::new();
    for a in &req.alignments {
        let t = a.alignable_type.trim().to_string();
        if t != "rubric_criterion" && t != "quiz_question" {
            return Err(AppError::invalid_input("alignableType must be rubric_criterion or quiz_question."));
        }
        rows.push((a.standard_id, a.alignable_id, t, a.weight));
    }
    sbg::replace_item_alignments(&state.pool, course_id, item_id, &rows).await?;
    sbg_grading::recompute_course_sbg(&state.pool, course_id, &course_code).await?;
    Ok(StatusCode::NO_CONTENT)
}
