//! API types for adaptive learning paths (plan 1.4).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::course_structure::CourseStructureItemResponse;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructurePathRuleResponse {
    pub id: Uuid,
    pub structure_item_id: Uuid,
    pub rule_type: String,
    pub concept_ids: Vec<Uuid>,
    pub threshold: f64,
    pub target_item_id: Option<Uuid>,
    pub priority: i16,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStructurePathRuleRequest {
    pub rule_type: String,
    pub concept_ids: Vec<Uuid>,
    pub threshold: f64,
    #[serde(default)]
    pub target_item_id: Option<Uuid>,
    #[serde(default)]
    pub priority: Option<i16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentNextResponse {
    pub item: CourseStructureItemResponse,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason_key: Option<String>,
    #[serde(default)]
    pub fallback: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutEnrollmentPathOverrideRequest {
    pub item_sequence: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptivePathPreviewResponse {
    pub path: Vec<Uuid>,
    #[serde(default)]
    pub fallback: bool,
}

#[derive(Debug, Deserialize)]
pub struct AdaptivePathPreviewQuery {
    /// JSON object: `{"<uuid>": 0.85, ...}` (concept id → mastery 0–1).
    pub mastery: String,
}
