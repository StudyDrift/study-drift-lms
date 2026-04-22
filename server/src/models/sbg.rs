//! API types for standards-based grading (plan 3.7).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgStandardPublic {
    pub id: Uuid,
    pub external_id: Option<String>,
    pub description: String,
    pub subject: Option<String>,
    pub grade_level: Option<String>,
    pub position: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgStandardsListResponse {
    pub standards: Vec<SbgStandardPublic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgGradebookCell {
    pub student_user_id: Uuid,
    pub standard_id: Uuid,
    pub level_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgStandardsGradebookResponse {
    pub standards: Vec<SbgStandardPublic>,
    /// Student ids in gradebook order (with display name).
    pub students: Vec<SbgGradebookStudent>,
    /// Proficiency display label per (student, standard) when available.
    pub proficiencies: Vec<SbgGradebookCell>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgGradebookStudent {
    pub user_id: Uuid,
    pub display_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgMasteryTranscriptRow {
    pub standard_id: Uuid,
    pub external_id: Option<String>,
    pub description: String,
    pub proficiency: Option<f64>,
    pub level_label: String,
    pub last_assessed: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgMasteryTranscriptResponse {
    pub course_title: String,
    pub course_code: String,
    pub student_user_id: Uuid,
    pub rows: Vec<SbgMasteryTranscriptRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgItemAlignmentsPut {
    /// Replaces all SBG alignments for this item (criterion and quiz-question links).
    pub alignments: Vec<SbgItemAlignmentItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbgItemAlignmentItem {
    pub standard_id: Uuid,
    pub alignable_type: String,
    pub alignable_id: Uuid,
    #[serde(default = "one_weight")]
    pub weight: f64,
}

fn one_weight() -> f64 {
    1.0
}
