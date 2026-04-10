use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CourseStructureItemRow {
    pub id: Uuid,
    #[allow(dead_code)]
    pub course_id: Uuid,
    pub sort_order: i32,
    pub kind: String,
    pub title: String,
    pub parent_id: Option<Uuid>,
    pub published: bool,
    pub visible_from: Option<DateTime<Utc>>,
    pub archived: bool,
    pub due_at: Option<DateTime<Utc>>,
    pub assignment_group_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseStructureItemResponse {
    pub id: Uuid,
    pub sort_order: i32,
    pub kind: String,
    pub title: String,
    pub parent_id: Option<Uuid>,
    pub published: bool,
    pub visible_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub archived: bool,
    pub due_at: Option<DateTime<Utc>>,
    pub assignment_group_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Present for quiz items when loaded from the API: adaptive vs traditional.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_adaptive: Option<bool>,
}

impl From<CourseStructureItemRow> for CourseStructureItemResponse {
    fn from(row: CourseStructureItemRow) -> Self {
        CourseStructureItemResponse {
            id: row.id,
            sort_order: row.sort_order,
            kind: row.kind,
            title: row.title,
            parent_id: row.parent_id,
            published: row.published,
            visible_from: row.visible_from,
            archived: row.archived,
            due_at: row.due_at,
            assignment_group_id: row.assignment_group_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            is_adaptive: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseStructureResponse {
    pub items: Vec<CourseStructureItemResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCourseModuleRequest {
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCourseModuleRequest {
    pub title: String,
    pub published: bool,
    pub visible_from: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchStructureItemRequest {
    pub title: Option<String>,
    pub published: Option<bool>,
    /// When `false`, restores an archived module child item. When `true`, soft-archives (same as `DELETE` on the item).
    pub archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCourseHeadingRequest {
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCourseAssignmentRequest {
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderCourseStructureRequest {
    pub module_order: Vec<Uuid>,
    /// Maps each module id to ordered child item ids (headings and content pages). Omit keys for empty modules.
    pub child_order_by_module: HashMap<Uuid, Vec<Uuid>>,
}
