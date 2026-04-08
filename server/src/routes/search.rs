use axum::{extract::State, http::HeaderMap, routing::get, Json, Router};

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::search::{SearchCourseItem, SearchIndexResponse};
use crate::repos::{course, enrollment};
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
        })
        .collect();

    let people = enrollment::list_people_for_enrolled_courses(&state.pool, user.user_id).await?;

    Ok(Json(SearchIndexResponse { courses, people }))
}
