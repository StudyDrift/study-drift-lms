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
    #[serde(default = "default_export_max_attempts")]
    pub max_attempts: i32,
    #[serde(default = "default_export_grade_attempt_policy")]
    pub grade_attempt_policy: String,
    #[serde(default)]
    pub passing_score_percent: Option<i32>,
    #[serde(default = "default_export_late_submission_policy")]
    pub late_submission_policy: String,
    #[serde(default)]
    pub late_penalty_percent: Option<i32>,
    #[serde(default)]
    pub time_limit_minutes: Option<i32>,
    #[serde(default)]
    pub timer_pause_when_tab_hidden: bool,
    #[serde(default)]
    pub per_question_time_limit_seconds: Option<i32>,
    #[serde(default = "default_export_show_score_timing")]
    pub show_score_timing: String,
    #[serde(default = "default_export_review_visibility")]
    pub review_visibility: String,
    #[serde(default = "default_export_review_when")]
    pub review_when: String,
    #[serde(default)]
    pub one_question_at_a_time: bool,
    #[serde(default)]
    pub shuffle_questions: bool,
    #[serde(default)]
    pub shuffle_choices: bool,
    #[serde(default = "default_export_allow_back_navigation")]
    pub allow_back_navigation: bool,
    #[serde(default)]
    pub quiz_access_code: Option<String>,
    #[serde(default = "default_export_adaptive_difficulty")]
    pub adaptive_difficulty: String,
    #[serde(default = "default_export_adaptive_topic_balance")]
    pub adaptive_topic_balance: bool,
    #[serde(default = "default_export_adaptive_stop_rule")]
    pub adaptive_stop_rule: String,
    #[serde(default)]
    pub random_question_pool_count: Option<i32>,
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

fn default_export_max_attempts() -> i32 {
    1
}

fn default_export_grade_attempt_policy() -> String {
    "latest".to_string()
}

fn default_export_late_submission_policy() -> String {
    "allow".to_string()
}

fn default_export_show_score_timing() -> String {
    "immediate".to_string()
}

fn default_export_review_visibility() -> String {
    "full".to_string()
}

fn default_export_review_when() -> String {
    "always".to_string()
}

fn default_export_allow_back_navigation() -> bool {
    true
}

fn default_export_adaptive_difficulty() -> String {
    "standard".to_string()
}

fn default_export_adaptive_topic_balance() -> bool {
    true
}

fn default_export_adaptive_stop_rule() -> String {
    "fixed_count".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseExportV1 {
    pub format_version: i32,
    pub exported_at: DateTime<Utc>,
    pub course_code: String,
    pub course: CourseExportSnapshot,
    pub syllabus: Vec<SyllabusSection>,
    #[serde(default)]
    pub require_syllabus_acceptance: bool,
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
