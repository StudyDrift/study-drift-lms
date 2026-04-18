use axum::{extract::State, http::HeaderMap, routing::get, Json, Router};

use crate::authz::any_grant_matches;
use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::search::{SearchCourseItem, SearchIndexResponse};
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::enrollment;
use crate::repos::rbac;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/search", get(search_index_handler))
}

async fn search_index_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SearchIndexResponse>, AppError> {
    let user = auth_user(&state, &headers)?;

    let courses_raw = course::list_for_enrolled_user(&state.pool, user.user_id).await?;
    let courses: Vec<SearchCourseItem> = courses_raw
        .into_iter()
        .map(|c| SearchCourseItem {
            course_code: c.course_code,
            title: c.title,
            notebook_enabled: c.notebook_enabled,
            feed_enabled: c.feed_enabled,
            calendar_enabled: c.calendar_enabled,
        })
        .collect();

    let people_raw =
        enrollment::list_people_for_enrolled_courses(&state.pool, user.user_id).await?;
    let grants = rbac::list_granted_permission_strings(&state.pool, user.user_id).await?;
    let people: Vec<_> = people_raw
        .into_iter()
        .filter(|p| {
            let required = course_grants::course_enrollments_read_permission(&p.course_code);
            any_grant_matches(&grants, &required)
        })
        .collect();

    Ok(Json(SearchIndexResponse { courses, people }))
}
