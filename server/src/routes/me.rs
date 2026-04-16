use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::me::MyPermissionsResponse;
use crate::models::student_notebook_rag::{
    StudentNotebookDocInput, StudentNotebookRagRequest, StudentNotebookRagResponse,
};
use crate::repos::{enrollment, rbac};
use crate::services::student_notebook_rag_ai;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/me/permissions", get(get_my_permissions))
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
                    return Err(AppError::InvalidInput(
                        "viewAs must be \"teacher\" or \"student\".".into(),
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
                    return Err(AppError::InvalidInput(
                        "Not enrolled as a student in this course.".into(),
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
                return Err(AppError::InvalidInput(
                    "courseCode is required when viewAs is set.".into(),
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
