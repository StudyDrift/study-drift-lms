use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use uuid::Uuid;

/// User-defined Markdown reading theme (when `markdown_theme_preset` is `custom`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownThemeCustom {
    #[serde(default)]
    pub heading_color: Option<String>,
    #[serde(default)]
    pub body_color: Option<String>,
    #[serde(default)]
    pub link_color: Option<String>,
    #[serde(default)]
    pub code_background: Option<String>,
    #[serde(default)]
    pub blockquote_border: Option<String>,
    /// `narrow` | `comfortable` | `wide` | `full`
    #[serde(default)]
    pub article_width: Option<String>,
    /// `sans` | `serif`
    #[serde(default)]
    pub font_family: Option<String>,
}

/// [`CoursePublic`] plus enrollment context for the signed-in user (single-course GET).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseWithViewerResponse {
    #[serde(flatten)]
    pub course: CoursePublic,
    /// Raw enrollment roles for the authenticated user in this course (e.g. `teacher`, `student`).
    pub viewer_enrollment_roles: Vec<String>,
    /// Present when the viewer has a `student` enrollment row in this course (adaptive path / next-item APIs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_student_enrollment_id: Option<Uuid>,
}

#[derive(Debug, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoursePublic {
    pub id: Uuid,
    pub course_code: String,
    pub title: String,
    pub description: String,
    pub hero_image_url: Option<String>,
    /// CSS `object-position` for cropped hero banners (e.g. `50% 30%`).
    pub hero_image_object_position: Option<String>,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub visible_from: Option<DateTime<Utc>>,
    pub hidden_at: Option<DateTime<Utc>>,
    /// `fixed` or `relative` (enrollment-based window; module dates shift from anchor).
    pub schedule_mode: String,
    /// ISO 8601 duration (e.g. P90D) from enrollment for course end when `schedule_mode` is relative.
    pub relative_end_after: Option<String>,
    /// ISO 8601 duration from enrollment for catalog hide when relative.
    pub relative_hidden_after: Option<String>,
    /// Reference instant for authored module `visible_from` / due dates in relative mode.
    pub relative_schedule_anchor_at: Option<DateTime<Utc>>,
    pub published: bool,
    /// Preset id: classic, reader, serif, contrast, night, accent, or custom.
    pub markdown_theme_preset: String,
    pub markdown_theme_custom: Option<JsonValue>,
    /// Display grading scale id (see `GRADING_SCALES`).
    pub grading_scale: String,
    /// When true, hidden from dashboards and search for all enrollments.
    pub archived: bool,
    /// Student course notebook page (local notes UI); when false, nav and client treat as off.
    pub notebook_enabled: bool,
    /// Course discussion feed and related APIs.
    pub feed_enabled: bool,
    /// Course-level due-date calendar view.
    pub calendar_enabled: bool,
    /// Normalized question bank + pool delivery (see `services::question_bank`).
    pub question_bank_enabled: bool,
    /// When true, instructors may configure quiz lockdown / kiosk delivery (plan 2.10).
    pub lockdown_mode_enabled: bool,
    /// K-12 standards alignment UI and coverage APIs (plan 1.3).
    pub standards_alignment_enabled: bool,
    /// When true and the platform flag is on, adaptive path rules may reroute learners between modules.
    pub adaptive_paths_enabled: bool,
    /// Spaced repetition / review queue for question-bank items (also requires `SRS_PRACTICE_ENABLED`).
    pub srs_enabled: bool,
    /// Placement diagnostic before adaptive routing (also requires `DIAGNOSTIC_ASSESSMENTS_ENABLED`).
    pub diagnostic_assessments_enabled: bool,
    /// Progressive quiz hints + worked examples (plan 1.9).
    pub hint_scaffolding_enabled: bool,
    /// Tagged distractor remediation + misconception reporting (plan 1.10).
    pub misconception_detection_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct CoursesResponse {
    pub courses: Vec<CoursePublic>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCourseRequest {
    pub title: String,
    pub description: String,
    pub published: bool,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub visible_from: Option<DateTime<Utc>>,
    pub hidden_at: Option<DateTime<Utc>>,
    /// Omit to leave the course schedule mode unchanged (backward compatible).
    #[serde(default)]
    pub schedule_mode: Option<String>,
    #[serde(default)]
    pub relative_end_after: Option<String>,
    #[serde(default)]
    pub relative_hidden_after: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetHeroImageRequest {
    /// New hero image URL; omit when only updating `object_position`.
    #[serde(default)]
    pub image_url: Option<String>,
    /// CSS `object-position`. Omit to leave unchanged; JSON `null` resets to default (center).
    #[serde(default)]
    pub object_position: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCourseRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMarkdownThemeRequest {
    pub preset: String,
    #[serde(default)]
    pub custom: Option<MarkdownThemeCustom>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCourseFeaturesRequest {
    pub notebook_enabled: bool,
    pub feed_enabled: bool,
    pub calendar_enabled: bool,
    pub question_bank_enabled: bool,
    #[serde(default)]
    pub lockdown_mode_enabled: bool,
    /// When omitted, the previous course value is preserved (backward compatible PATCH body).
    #[serde(default)]
    pub standards_alignment_enabled: Option<bool>,
    #[serde(default)]
    pub adaptive_paths_enabled: Option<bool>,
    #[serde(default)]
    pub srs_enabled: Option<bool>,
    #[serde(default)]
    pub diagnostic_assessments_enabled: Option<bool>,
    #[serde(default)]
    pub hint_scaffolding_enabled: Option<bool>,
    #[serde(default)]
    pub misconception_detection_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCourseArchivedRequest {
    pub archived: bool,
}

/// Body for `PUT /api/v1/courses/catalog-order` — UUIDs in display order for the signed-in user's catalog.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutCourseCatalogOrderRequest {
    pub course_ids: Vec<Uuid>,
}

pub const MARKDOWN_THEME_PRESETS: &[&str] = &[
    "classic", "reader", "serif", "contrast", "night", "accent", "custom",
];

pub const GRADING_SCALES: &[&str] = &[
    "letter_standard",
    "letter_plus_minus",
    "percent",
    "pass_fail",
];
