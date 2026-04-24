use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::delete,
    routing::get, routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::me::MyPermissionsResponse;
use crate::models::student_notebook_rag::{
    StudentNotebookDocInput, StudentNotebookRagRequest, StudentNotebookRagResponse,
};
use crate::repos::{enrollment, oidc as oidc_repo, rbac};
use crate::services::student_notebook_rag_ai;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/me/permissions", get(get_my_permissions))
        .route("/api/v1/me/oidc-identities", get(get_my_oidc_identities))
        .route(
            "/api/v1/me/oidc-identities/{id}",
            delete(delete_my_oidc_identity),
        )
        .route("/api/v1/me/notebooks/query", post(post_notebooks_query))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MePermissionsQuery {
    #[serde(default)]
    course_code: Option<String>,
    /// `teacher` (default) or `student` — only applies when `course_code` is set.
    #[serde(default)]
    view_as: Option<String>,
}

async fn get_my_permissions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MePermissionsQuery>,
) -> Result<Json<MyPermissionsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let permission_strings = match query
        .course_code
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        Some(cc) => {
            let view_as_student = match query.view_as.as_deref().map(str::trim) {
                None | Some("") | Some("teacher") => false,
                Some("student") => true,
                Some(_) => {
                    return Err(AppError::invalid_input(
                        "viewAs must be \"teacher\" or \"student\".",
                    ));
                }
            };
            let in_course = enrollment::user_has_access(&state.pool, cc, user.user_id).await?;
            if !in_course {
                if view_as_student {
                    return Err(AppError::NotFound);
                }
                rbac::list_granted_permission_strings(&state.pool, user.user_id).await?
            } else if view_as_student {
                if !enrollment::user_has_enrollment_role(&state.pool, cc, user.user_id, "student")
                    .await?
                {
                    return Err(AppError::invalid_input(
                        "Not enrolled as a student in this course.",
                    ));
                }
                rbac::list_granted_permission_strings_course_view(
                    &state.pool,
                    user.user_id,
                    cc,
                    true,
                )
                .await?
            } else if enrollment::user_is_course_staff(&state.pool, cc, user.user_id).await? {
                rbac::list_granted_permission_strings(&state.pool, user.user_id).await?
            } else {
                rbac::list_granted_permission_strings_course_view(
                    &state.pool,
                    user.user_id,
                    cc,
                    true,
                )
                .await?
            }
        }
        None => {
            if query.view_as.is_some() {
                return Err(AppError::invalid_input(
                    "courseCode is required when viewAs is set.",
                ));
            }
            rbac::list_granted_permission_strings(&state.pool, user.user_id).await?
        }
    };
    Ok(Json(MyPermissionsResponse { permission_strings }))
}

async fn post_notebooks_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StudentNotebookRagRequest>,
) -> Result<Json<StudentNotebookRagResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let client = state
        .open_router
        .as_ref()
        .ok_or(AppError::AiNotConfigured)?;

    let StudentNotebookRagRequest {
        question,
        notebooks: raw,
    } = req;

    let notebooks: Vec<StudentNotebookDocInput> = raw
        .into_iter()
        .filter_map(|mut n| {
            n.course_code = n.course_code.trim().to_string();
            n.course_title = n.course_title.trim().to_string();
            n.markdown = n.markdown.trim().to_string();
            if n.course_code.is_empty() || n.markdown.is_empty() {
                return None;
            }
            if n.course_title.is_empty() {
                n.course_title = n.course_code.clone();
            }
            Some(n)
        })
        .collect();

    student_notebook_rag_ai::answer_notebook_question(
        &state.pool,
        client.as_ref(),
        user.user_id,
        &question,
        &notebooks,
    )
    .await
    .map(Json)
}

async fn get_my_oidc_identities(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let u = auth_user(&state, &headers)?;
    let rows = oidc_repo::list_identities_for_user(&state.pool, u.user_id).await?;
    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.id,
                "provider": r.provider,
                "email": r.email
            })
        })
        .collect();
    Ok(Json(json!({ "identities": items })))
}

async fn delete_my_oidc_identity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(identity_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let u = auth_user(&state, &headers)?;
    let ok = oidc_repo::delete_identity_by_id_for_user(&state.pool, u.user_id, identity_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "ok": true })))
}
