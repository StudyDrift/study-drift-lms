use crate::models::course_grading::AssignmentGroupPublic;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradebookGridResponse {
    pub students: Vec<CourseGradebookGridStudent>,
    pub columns: Vec<CourseGradebookGridColumn>,
    /// Saved points per student id and gradable module item id (empty cells omitted).
    #[serde(default)]
    pub grades: HashMap<Uuid, HashMap<Uuid, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutCourseGradebookGradesRequest {
    /// Per student, per module item id string scores (empty string clears the cell).
    pub grades: HashMap<Uuid, HashMap<Uuid, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradebookGridStudent {
    pub user_id: Uuid,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradebookGridColumn {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub max_points: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_group_id: Option<Uuid>,
}

/// Student-facing grades: one row per gradable item plus weights for final %.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseMyGradesResponse {
    pub columns: Vec<CourseGradebookGridColumn>,
    /// Earned points per module item id (omitted when no grade entered).
    #[serde(default)]
    pub grades: HashMap<Uuid, String>,
    pub assignment_groups: Vec<AssignmentGroupPublic>,
}
