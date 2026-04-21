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
    #[serde(default = "default_export_schedule_mode")]
    pub schedule_mode: String,
    #[serde(default)]
    pub relative_end_after: Option<String>,
    #[serde(default)]
    pub relative_hidden_after: Option<String>,
    #[serde(default)]
    pub relative_schedule_anchor_at: Option<DateTime<Utc>>,
    pub published: bool,
    pub markdown_theme_preset: String,
    #[serde(default)]
    pub markdown_theme_custom: Option<JsonValue>,
    #[serde(default = "default_true")]
    pub notebook_enabled: bool,
    #[serde(default = "default_true")]
    pub feed_enabled: bool,
    #[serde(default = "default_true")]
    pub calendar_enabled: bool,
    #[serde(default)]
    pub question_bank_enabled: bool,
    #[serde(default)]
    pub lockdown_mode_enabled: bool,
    #[serde(default)]
    pub standards_alignment_enabled: bool,
    #[serde(default)]
    pub adaptive_paths_enabled: bool,
    #[serde(default)]
    pub srs_enabled: bool,
    #[serde(default)]
    pub diagnostic_assessments_enabled: bool,
    #[serde(default)]
    pub hint_scaffolding_enabled: bool,
    #[serde(default)]
    pub misconception_detection_enabled: bool,
}

fn default_export_schedule_mode() -> String {
    "fixed".to_string()
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
    #[serde(default)]
    pub points_worth: Option<i32>,
    #[serde(default)]
    pub available_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub available_until: Option<DateTime<Utc>>,
    #[serde(default)]
    pub assignment_access_code: Option<String>,
    #[serde(default = "default_true")]
    pub submission_allow_text: bool,
    #[serde(default)]
    pub submission_allow_file_upload: bool,
    #[serde(default)]
    pub submission_allow_url: bool,
    #[serde(default = "default_export_late_submission_policy")]
    pub late_submission_policy: String,
    #[serde(default)]
    pub late_penalty_percent: Option<i32>,
    #[serde(default)]
    pub rubric: Option<JsonValue>,
}

fn default_true() -> bool {
    true
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
    #[serde(default)]
    pub points_worth: Option<i32>,
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
    #[serde(default = "default_export_lockdown_mode")]
    pub lockdown_mode: String,
    #[serde(default)]
    pub focus_loss_threshold: Option<i32>,
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
    #[serde(default = "default_export_adaptive_delivery_mode")]
    pub adaptive_delivery_mode: String,
}

fn default_export_adaptive_delivery_mode() -> String {
    "ai".to_string()
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

fn default_export_lockdown_mode() -> String {
    "standard".to_string()
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

/// One roster row for import/export (`role` is the DB enrollment role: `student`, `instructor`, or `teacher`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedCourseEnrollment {
    /// Email for matching an existing Lexters account (normalized to lowercase on import).
    pub email: String,
    pub role: String,
    /// When `role` is `instructor`, RBAC catalog (`Teacher` or `TA`) used for per-course permission grants.
    /// Omitted in legacy exports; importers default to `TA`.
    #[serde(default)]
    pub instructor_grant_role: Option<String>,
    /// Optional display name when creating a new user from this row (e.g. from Canvas `user.name`).
    #[serde(default)]
    pub display_name: Option<String>,
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
    #[serde(default)]
    pub enrollments: Vec<ExportedCourseEnrollment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseImportRequest {
    pub mode: CourseImportMode,
    /// Full export object (same shape as `GET …/export`).
    #[serde(rename = "export")]
    pub export: CourseExportV1,
}

/// Which parts of a Canvas course to pull into the export bundle (and apply on import).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasImportInclude {
    #[serde(default = "default_true")]
    pub modules: bool,
    #[serde(default = "default_true")]
    pub assignments: bool,
    #[serde(default = "default_true")]
    pub quizzes: bool,
    #[serde(default = "default_true")]
    pub enrollments: bool,
    #[serde(default = "default_true")]
    pub grades: bool,
    #[serde(default = "default_true")]
    pub settings: bool,
}

impl Default for CanvasImportInclude {
    fn default() -> Self {
        Self {
            modules: true,
            assignments: true,
            quizzes: true,
            enrollments: true,
            grades: true,
            settings: true,
        }
    }
}

/// Import a Canvas course via the Canvas REST API (server-side proxy; token is not stored).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseCanvasImportRequest {
    pub mode: CourseImportMode,
    /// Canvas root URL, e.g. `https://school.instructure.com` (no `/api/v1` suffix).
    pub canvas_base_url: String,
    /// Canvas numeric course id (same as in the course URL).
    pub canvas_course_id: String,
    /// Short-lived Canvas access token with permission to read the course.
    pub access_token: String,
    #[serde(default)]
    pub include: CanvasImportInclude,
}
