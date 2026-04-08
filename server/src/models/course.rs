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
    pub published: bool,
    /// Preset id: classic, reader, serif, contrast, night, accent, or custom.
    pub markdown_theme_preset: String,
    pub markdown_theme_custom: Option<JsonValue>,
    /// Display grading scale id (see `GRADING_SCALES`).
    pub grading_scale: String,
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

pub const MARKDOWN_THEME_PRESETS: &[&str] = &[
    "classic", "reader", "serif", "contrast", "night", "accent", "custom",
];

pub const GRADING_SCALES: &[&str] = &[
    "letter_standard",
    "letter_plus_minus",
    "percent",
    "pass_fail",
];
