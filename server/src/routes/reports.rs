use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;

use crate::error::AppError;
use crate::http_auth::require_permission;
use crate::models::reports::{DateRange, LearningActivityReport};
use crate::repos::reports::{
    learning_activity_by_day, learning_activity_by_event_kind, learning_activity_summary,
    learning_activity_top_courses,
};
use crate::state::AppState;

const PERM_REPORTS_VIEW: &str = "global:app:reports:view";
const TOP_COURSES_LIMIT: i64 = 15;
const MAX_RANGE_DAYS: i64 = 366;

#[derive(Debug, Deserialize)]
pub struct LearningActivityQuery {
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
}

fn parse_rfc3339(s: &str) -> Result<DateTime<Utc>, AppError> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| {
            AppError::invalid_input(
                "Invalid `from` or `to`: use RFC 3339 (e.g. 2026-04-01T00:00:00Z).",
            )
        })
}

fn resolve_range(q: &LearningActivityQuery) -> Result<(DateTime<Utc>, DateTime<Utc>), AppError> {
    let now = Utc::now();
    let to = match &q.to {
        Some(s) => parse_rfc3339(s)?,
        None => now,
    };
    let from = match &q.from {
        Some(s) => parse_rfc3339(s)?,
        None => to - Duration::days(30),
    };
    if from >= to {
        return Err(AppError::invalid_input("`from` must be before `to`."));
    }
    let days = (to - from).num_days();
    if days > MAX_RANGE_DAYS {
        return Err(AppError::invalid_input(format!(
            "Date range cannot exceed {MAX_RANGE_DAYS} days."
        )));
    }
    Ok((from, to))
}

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/v1/reports/learning-activity",
        get(get_learning_activity),
    )
}

async fn get_learning_activity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LearningActivityQuery>,
) -> Result<Json<LearningActivityReport>, AppError> {
    let _user = require_permission(&state, &headers, PERM_REPORTS_VIEW).await?;
    let (from, to) = resolve_range(&q)?;

    let summary = learning_activity_summary(&state.pool, from, to).await?;
    let by_day = learning_activity_by_day(&state.pool, from, to).await?;
    let by_event_kind = learning_activity_by_event_kind(&state.pool, from, to).await?;
    let top_courses =
        learning_activity_top_courses(&state.pool, from, to, TOP_COURSES_LIMIT).await?;

    Ok(Json(LearningActivityReport {
        range: DateRange { from, to },
        summary,
        by_day,
        by_event_kind,
        top_courses,
    }))
}
