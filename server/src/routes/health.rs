use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::db::schema;
use crate::state::AppState;

pub async fn get() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "StudyDrift"
    }))
}

/// Verifies Postgres connectivity and that migrations have been applied (e.g. `courses.hero_image_url` exists).
pub async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query(&format!(
        "SELECT hero_image_url FROM {} LIMIT 0",
        schema::COURSES
    ))
        .execute(&state.pool)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "ready",
                "database": "ok",
                "schema": "courses table includes hero_image_url (migrations applied)"
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "readiness check failed");
            let detail = e.to_string();
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "status": "not_ready",
                    "error": "Database is unreachable or migrations are missing. Ensure Postgres is running and RUN_MIGRATIONS=true (or run sqlx migrations manually).",
                    "detail": detail
                })),
            )
                .into_response()
        }
    }
}
