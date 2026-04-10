use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::models::course_grading::CourseGradingSettingsResponse;
use crate::models::course_module_quiz::QuizQuestion;
use crate::models::course_structure::CourseStructureItemResponse;
use crate::models::course_syllabus::SyllabusSection;

/// Wire/API representation of an import mode (camelCase JSON).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CourseImportMode {
    /// Remove all modules, syllabus, and related bodies, then apply the export.
    Erase,
    /// Only create missing assignment groups, syllabus sections, and structure items (by id). Does not change existing rows.
    MergeAdd,
    /// Upsert from the export and delete local structure items (and orphan bodies) not present in the export. Replaces syllabus and grading from the file.
    Overwrite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseExportSnapshot {
    pub title: String,
    pub description: String,
    pub hero_image_url: Option<String>,
    pub hero_image_object_position: Option<String>,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub visible_from: Option<DateTime<Utc>>,
    pub hidden_at: Option<DateTime<Utc>>,
    pub published: bool,
    pub markdown_theme_preset: String,
    #[serde(default)]
    pub markdown_theme_custom: Option<JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedContentPageBody {
    pub markdown: String,
    #[serde(default)]
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAssignmentBody {
    pub markdown: String,
    #[serde(default)]
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedQuizBody {
    pub markdown: String,
    #[serde(default)]
    pub due_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub available_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub available_until: Option<DateTime<Utc>>,
    #[serde(default)]
    pub unlimited_attempts: bool,
    #[serde(default)]
    pub one_question_at_a_time: bool,
    pub questions: Vec<QuizQuestion>,
    #[serde(default)]
    pub is_adaptive: bool,
    #[serde(default)]
    pub adaptive_system_prompt: String,
    #[serde(default)]
    pub adaptive_source_item_ids: Vec<Uuid>,
    #[serde(default = "default_export_adaptive_question_count")]
    pub adaptive_question_count: i32,
}

fn default_export_adaptive_question_count() -> i32 {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseExportV1 {
    pub format_version: i32,
    pub exported_at: DateTime<Utc>,
    pub course_code: String,
    pub course: CourseExportSnapshot,
    pub syllabus: Vec<SyllabusSection>,
    pub grading: CourseGradingSettingsResponse,
    pub structure: Vec<CourseStructureItemResponse>,
    #[serde(default)]
    pub content_pages: std::collections::HashMap<Uuid, ExportedContentPageBody>,
    #[serde(default)]
    pub assignments: std::collections::HashMap<Uuid, ExportedAssignmentBody>,
    #[serde(default)]
    pub quizzes: std::collections::HashMap<Uuid, ExportedQuizBody>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseImportRequest {
    pub mode: CourseImportMode,
    /// Full export object (same shape as `GET …/export`).
    #[serde(rename = "export")]
    pub export: CourseExportV1,
}
