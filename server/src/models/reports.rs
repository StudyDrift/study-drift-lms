use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningActivityReport {
    pub range: DateRange,
    pub summary: LearningActivitySummary,
    pub by_day: Vec<DayActivityBucket>,
    pub by_event_kind: Vec<EventKindCount>,
    pub top_courses: Vec<CourseActivityRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DateRange {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningActivitySummary {
    pub total_events: i64,
    pub unique_users: i64,
    pub unique_courses: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DayActivityBucket {
    pub day: chrono::NaiveDate,
    pub course_visit: i64,
    pub content_open: i64,
    pub content_leave: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventKindCount {
    pub event_kind: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseActivityRow {
    pub course_id: uuid::Uuid,
    pub course_code: String,
    pub title: String,
    pub event_count: i64,
}
