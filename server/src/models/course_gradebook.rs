use crate::models::assignment_rubric::RubricDefinition;
use crate::models::course_grading::AssignmentGroupPublic;
use chrono::{DateTime, Utc};
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
    /// Human-readable grade per cell (depends on course scheme and column display type).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub display_grades: HashMap<Uuid, HashMap<Uuid, String>>,
    /// Per-criterion rubric scores: student → item → criterion id → points string.
    #[serde(default)]
    pub rubric_scores: HashMap<Uuid, HashMap<Uuid, HashMap<Uuid, String>>>,
    /// Plan 3.8 — assignment + manual + unposted cells (instructor: lock in UI; score still in `grades`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub grade_held: HashMap<Uuid, HashMap<Uuid, bool>>,
    /// Plan 3.9 — student → item id → whether that score is dropped for course total.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub dropped_grades: HashMap<Uuid, HashMap<Uuid, bool>>,
    /// Plan 3.12 — excused: excluded from course/scheme math; shown as EX in the grid.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub excused_grades: HashMap<Uuid, HashMap<Uuid, bool>>,
    /// Active course grading scheme (omit when none — gradebook uses raw points).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grading_scheme: Option<GradingSchemeSummary>,
    /// Plan 3.11 — bulk CSV import/export available when the server has `GRADEBOOK_CSV_ENABLED=1`.
    #[serde(default)]
    pub gradebook_csv_enabled: bool,
}

/// Minimal scheme payload for clients building selects (letter options, pass threshold, etc.).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradingSchemeSummary {
    #[serde(rename = "type")]
    pub scheme_type: String,
    pub scale_json: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutCourseGradebookGradesRequest {
    /// Per student, per module item id string scores (empty string clears the cell).
    pub grades: HashMap<Uuid, HashMap<Uuid, String>>,
    /// Optional rubric breakdown per student and assignment item (criterion id → points).
    #[serde(default)]
    pub rubric_scores: HashMap<Uuid, HashMap<Uuid, HashMap<Uuid, f64>>>,
    /// Free-text reason for the batch (3.10 audit); stored on each cell update.
    #[serde(default)]
    pub change_reason: Option<String>,
}

/// PATCH body for toggling excused on one gradebook cell (plan 3.12).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCourseGradebookExcusedRequest {
    pub student_id: Uuid,
    pub excused: bool,
    #[serde(default)]
    pub reason: Option<String>,
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
    /// Present for assignment columns when a rubric is configured.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rubric: Option<RubricDefinition>,
    /// Assignment-only: overrides course scheme when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_grading_type: Option<String>,
    /// Resolved display mode for this column (`points`, `letter`, …).
    pub effective_display_type: String,
    /// Plan 3.8 — for assignment columns: `automatic` or `manual`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub posting_policy: Option<String>,
    /// Plan 3.8 — scheduled release.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_at: Option<DateTime<Utc>>,
    /// Plan 3.9 — this score cannot be dropped in its assignment group.
    #[serde(default)]
    pub never_drop: bool,
    /// Plan 3.9 — this item is the final used for replace-lowest policy.
    #[serde(default)]
    pub replace_with_final: bool,
}

/// Student-facing grades: one row per gradable item plus weights for final %.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseMyGradesResponse {
    pub columns: Vec<CourseGradebookGridColumn>,
    /// Earned points per module item id (omitted when no grade entered).
    #[serde(default)]
    pub grades: HashMap<Uuid, String>,
    /// Display string per item id (letter, pass/fail, etc.).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub display_grades: HashMap<Uuid, String>,
    pub assignment_groups: Vec<AssignmentGroupPublic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grading_scheme: Option<GradingSchemeSummary>,
    /// Plan 3.8 — has an entered grade that is not yet posted to students.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held_grade_item_ids: Vec<Uuid>,
    /// Plan 3.9 — item id → score excluded by group drop policy (student view).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub dropped_grades: HashMap<Uuid, bool>,
    /// Plan 3.12 — per gradable item: `excused` | `graded` when a row exists; omitted when ungraded.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub grade_statuses: HashMap<Uuid, String>,
}

/// One row in the grade change audit (3.10), JSON for API.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeHistoryEventOut {
    pub id: Uuid,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub changed_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeHistoryResponse {
    pub events: Vec<GradeHistoryEventOut>,
}

// --- Plan 3.11 — bulk CSV import preview

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradebookImportStats {
    pub unchanged: u32,
    pub updated: u32,
    pub added: u32,
    pub errors: u32,
    pub warnings: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradebookImportCellPreview {
    pub item_id: Uuid,
    pub previous_score: Option<String>,
    pub new_score: String,
    pub state: String,
    pub out_of_range: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradebookImportPreviewRow {
    pub row_index: usize,
    pub student_id: Option<Uuid>,
    pub student_name: Option<String>,
    pub error: Option<String>,
    pub cells: Vec<GradebookImportCellPreview>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradebookImportConfirmRequest {
    pub token: Uuid,
    /// Required when `requireBlindManualHoldAck` was true on validate.
    #[serde(default)]
    pub acknowledge_blind_manual_hold: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradebookImportValidateResponse {
    /// Present only when the import can be applied without blocking issues.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<Uuid>,
    pub confirmable: bool,
    pub stats: GradebookImportStats,
    pub rows: Vec<GradebookImportPreviewRow>,
    pub require_blind_manual_hold_ack: bool,
}
