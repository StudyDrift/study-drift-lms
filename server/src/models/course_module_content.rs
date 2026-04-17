use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::assignment_rubric::RubricDefinition;

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
    /// Assignment only: learners cannot open before this (shifted when course uses relative schedule).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_from: Option<DateTime<Utc>>,
    /// Assignment only: assignment closes after this instant.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_until: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires_assignment_access_code: Option<bool>,
    /// Instructors only: plain text when a code is set (omit for learners).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_access_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submission_allow_text: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submission_allow_file_upload: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submission_allow_url: Option<bool>,
    /// Assignment only: `allow`, `penalty`, or `block`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub late_submission_policy: Option<String>,
    /// Assignment only: percent deducted from earned score when policy is `penalty`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub late_penalty_percent: Option<i32>,
    /// Assignment only: optional rubric (criteria with point-band levels).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rubric: Option<RubricDefinition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAssignmentRubricRequest {
    pub prompt: String,
    /// Current assignment body (Markdown), e.g. the unsaved editor draft; included in the AI context.
    #[serde(default)]
    pub assignment_markdown: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAssignmentRubricResponse {
    pub rubric: RubricDefinition,
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
    /// Assignment only: visibility start (`null` clears).
    #[serde(default)]
    pub available_from: Option<Option<DateTime<Utc>>>,
    /// Assignment only: visibility end (`null` clears).
    #[serde(default)]
    pub available_until: Option<Option<DateTime<Utc>>>,
    /// Assignment only: omit unchanged; JSON `null` clears the code.
    #[serde(default)]
    pub assignment_access_code: Option<Option<String>>,
    #[serde(default)]
    pub submission_allow_text: Option<bool>,
    #[serde(default)]
    pub submission_allow_file_upload: Option<bool>,
    #[serde(default)]
    pub submission_allow_url: Option<bool>,
    #[serde(default)]
    pub late_submission_policy: Option<String>,
    #[serde(default)]
    pub late_penalty_percent: Option<Option<i32>>,
    /// Assignment only: omit to leave unchanged; JSON `null` clears the rubric.
    #[serde(default)]
    pub rubric: Option<Option<RubricDefinition>>,
}
