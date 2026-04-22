use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentGroupPublic {
    pub id: Uuid,
    pub sort_order: i32,
    pub name: String,
    pub weight_percent: f64,
    /// Drop this many lowest scores in the group (plan 3.9).
    #[serde(default)]
    pub drop_lowest: i32,
    #[serde(default)]
    pub drop_highest: i32,
    /// When set with a per-item `replaceWithFinal` designation, a low non-final can use the final’s percent.
    #[serde(default)]
    pub replace_lowest_with_final: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradingSettingsResponse {
    pub grading_scale: String,
    pub assignment_groups: Vec<AssignmentGroupPublic>,
    /// Plan 3.7 — standards-based grading.
    pub sbg_enabled: bool,
    pub sbg_proficiency_scale_json: Option<JsonValue>,
    pub sbg_aggregation_rule: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentGroupInput {
    #[serde(default)]
    pub id: Option<Uuid>,
    pub name: String,
    pub sort_order: i32,
    pub weight_percent: f64,
    #[serde(default)]
    pub drop_lowest: Option<i32>,
    #[serde(default)]
    pub drop_highest: Option<i32>,
    #[serde(default)]
    pub replace_lowest_with_final: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutCourseGradingSettingsRequest {
    pub grading_scale: String,
    pub assignment_groups: Vec<AssignmentGroupInput>,
    /// When set, updates course SBG flags (JSON `null` clears scale; omit to leave unchanged).
    #[serde(default)]
    pub sbg_enabled: Option<bool>,
    #[serde(default)]
    pub sbg_proficiency_scale_json: Option<Option<JsonValue>>,
    #[serde(default)]
    pub sbg_aggregation_rule: Option<String>,
}

/// Partial SBG config on `PUT /grading` (plan 3.7). All fields `None` = do not change.
#[derive(Debug, Default, Clone)]
pub struct PutSbgConfig {
    pub enabled: Option<bool>,
    /// `None` in inner = set DB column to NULL; outer `None` = leave column unchanged.
    pub scale_json: Option<Option<JsonValue>>,
    pub aggregation_rule: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchItemAssignmentGroupRequest {
    pub assignment_group_id: Option<Uuid>,
}
