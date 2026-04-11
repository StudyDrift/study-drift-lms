use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleContentPageResponse {
    pub item_id: Uuid,
    pub title: String,
    pub markdown: String,
    pub due_at: Option<DateTime<Utc>>,
    pub points_worth: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_group_id: Option<Uuid>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCourseContentPageRequest {
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModuleContentPageRequest {
    pub markdown: String,
    /// Omit to leave unchanged; JSON `null` clears; ISO-8601 string sets the due time.
    #[serde(default)]
    pub due_at: Option<Option<DateTime<Utc>>>,
    /// Omit unchanged; JSON `null` clears.
    #[serde(default)]
    pub points_worth: Option<Option<i32>>,
}
