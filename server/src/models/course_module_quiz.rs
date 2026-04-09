use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizQuestion {
    pub id: String,
    pub prompt: String,
    #[serde(default = "default_question_type")]
    pub question_type: String,
    #[serde(default)]
    pub choices: Vec<String>,
    #[serde(default)]
    pub correct_choice_index: Option<usize>,
    #[serde(default)]
    pub multiple_answer: bool,
    #[serde(default)]
    pub answer_with_image: bool,
    #[serde(default = "default_required")]
    pub required: bool,
    #[serde(default = "default_points")]
    pub points: i32,
    #[serde(default = "default_estimated_minutes")]
    pub estimated_minutes: i32,
}

fn default_required() -> bool {
    true
}

fn default_question_type() -> String {
    "multiple_choice".to_string()
}

fn default_points() -> i32 {
    1
}

fn default_estimated_minutes() -> i32 {
    2
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleQuizResponse {
    pub item_id: Uuid,
    pub title: String,
    pub markdown: String,
    pub due_at: Option<DateTime<Utc>>,
    pub questions: Vec<QuizQuestion>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCourseQuizRequest {
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModuleQuizRequest {
    /// Omit to leave unchanged.
    #[serde(default)]
    pub markdown: Option<String>,
    /// Omit to leave unchanged.
    #[serde(default)]
    pub questions: Option<Vec<QuizQuestion>>,
    /// Omit to leave unchanged; JSON `null` clears; ISO-8601 string sets the due time.
    #[serde(default)]
    pub due_at: Option<Option<DateTime<Utc>>>,
}
