//! HTTP shapes for course learning outcomes (aligned with the LMS outcomes UI).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::repos::course_outcomes;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseOutcomesListResponse {
    pub enrolled_learners: i32,
    pub outcomes: Vec<CourseOutcomeApi>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseOutcomeApi {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub sort_order: i32,
    pub rollup_avg_score_percent: Option<f32>,
    pub links: Vec<CourseOutcomeLinkApi>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseOutcomeLinkApi {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_outcome_id: Option<Uuid>,
    pub structure_item_id: Uuid,
    pub target_kind: String,
    pub quiz_question_id: String,
    pub measurement_level: String,
    pub intensity_level: String,
    pub item_title: String,
    pub item_kind: String,
    pub progress: course_outcomes::OutcomeLinkProgress,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostCourseOutcomeRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCourseOutcomeRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    /// Set to anchor this outcome to a top-level module for competency sequencing (`null` clears).
    #[serde(default)]
    pub module_structure_item_id: Option<Option<Uuid>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostCourseOutcomeLinkRequest {
    pub structure_item_id: Uuid,
    pub target_kind: String,
    #[serde(default)]
    pub quiz_question_id: Option<String>,
    #[serde(default)]
    pub measurement_level: Option<String>,
    #[serde(default)]
    pub intensity_level: Option<String>,
    #[serde(default)]
    pub sub_outcome_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostCourseOutcomeSubOutcomeRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseOutcomeSubOutcomeApi {
    pub id: Uuid,
    pub outcome_id: Uuid,
    pub title: String,
    pub description: String,
    pub sort_order: i32,
}
