use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentGroupPublic {
    pub id: Uuid,
    pub sort_order: i32,
    pub name: String,
    pub weight_percent: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradingSettingsResponse {
    pub grading_scale: String,
    pub assignment_groups: Vec<AssignmentGroupPublic>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentGroupInput {
    #[serde(default)]
    pub id: Option<Uuid>,
    pub name: String,
    pub sort_order: i32,
    pub weight_percent: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutCourseGradingSettingsRequest {
    pub grading_scale: String,
    pub assignment_groups: Vec<AssignmentGroupInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchItemAssignmentGroupRequest {
    pub assignment_group_id: Option<Uuid>,
}
