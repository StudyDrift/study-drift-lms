use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

/// Matches LMS quiz editor and [`crate::services::quiz_generation_ai`].
pub const QUIZ_QUESTION_TYPES: &[&str] = &[
    "multiple_choice",
    "fill_in_blank",
    "essay",
    "true_false",
    "short_answer",
];

pub const MAX_QUIZ_QUESTIONS: usize = 300;
pub const MAX_QUIZ_PROMPT_LEN: usize = 10_000;
pub const MAX_QUIZ_CHOICES_PER_QUESTION: usize = 20;
pub const MAX_QUIZ_CHOICE_LEN: usize = 2_000;

pub const MAX_ADAPTIVE_SYSTEM_PROMPT_LEN: usize = 20_000;
pub const MAX_ADAPTIVE_SOURCE_ITEMS: usize = 50;
pub const MIN_ADAPTIVE_QUESTION_COUNT: i32 = 1;
pub const MAX_ADAPTIVE_QUESTION_COUNT: i32 = 30;

pub const ADAPTIVE_SOURCE_KINDS: &[&str] = &["content_page", "assignment", "quiz"];

pub fn validate_adaptive_quiz_settings(
    is_adaptive: bool,
    adaptive_system_prompt: &str,
    adaptive_source_item_ids: &[Uuid],
    adaptive_question_count: i32,
) -> Result<(), AppError> {
    if !is_adaptive {
        return Ok(());
    }
    if adaptive_system_prompt.len() > MAX_ADAPTIVE_SYSTEM_PROMPT_LEN {
        return Err(AppError::InvalidInput(
            "Adaptive system prompt is too long.".into(),
        ));
    }
    if adaptive_source_item_ids.is_empty() {
        return Err(AppError::InvalidInput(
            "Adaptive mode requires at least one course item with source content.".into(),
        ));
    }
    if adaptive_source_item_ids.len() > MAX_ADAPTIVE_SOURCE_ITEMS {
        return Err(AppError::InvalidInput(format!(
            "Too many adaptive source items (max {MAX_ADAPTIVE_SOURCE_ITEMS})."
        )));
    }
    if adaptive_question_count < MIN_ADAPTIVE_QUESTION_COUNT
        || adaptive_question_count > MAX_ADAPTIVE_QUESTION_COUNT
    {
        return Err(AppError::InvalidInput(format!(
            "adaptiveQuestionCount must be between {MIN_ADAPTIVE_QUESTION_COUNT} and {MAX_ADAPTIVE_QUESTION_COUNT}."
        )));
    }
    Ok(())
}

pub fn validate_quiz_questions(questions: &[QuizQuestion]) -> Result<(), AppError> {
    if questions.len() > MAX_QUIZ_QUESTIONS {
        return Err(AppError::InvalidInput(format!(
            "Too many quiz questions (max {MAX_QUIZ_QUESTIONS})."
        )));
    }
    for q in questions {
        if q.id.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Each quiz question needs an id.".into(),
            ));
        }
        if q.prompt.len() > MAX_QUIZ_PROMPT_LEN {
            return Err(AppError::InvalidInput(
                "A quiz question prompt is too long.".into(),
            ));
        }
        if !QUIZ_QUESTION_TYPES.contains(&q.question_type.as_str()) {
            return Err(AppError::InvalidInput("Unsupported quiz question type.".into()));
        }
        if q.choices.len() > MAX_QUIZ_CHOICES_PER_QUESTION {
            return Err(AppError::InvalidInput(
                "A quiz question has too many choices.".into(),
            ));
        }
        for c in &q.choices {
            if c.len() > MAX_QUIZ_CHOICE_LEN {
                return Err(AppError::InvalidInput(
                    "A quiz answer choice is too long.".into(),
                ));
            }
        }
        if let Some(idx) = q.correct_choice_index {
            if idx >= q.choices.len() {
                return Err(AppError::InvalidInput(
                    "A quiz correct answer index is out of range.".into(),
                ));
            }
        }
    }
    Ok(())
}

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
    pub available_from: Option<DateTime<Utc>>,
    pub available_until: Option<DateTime<Utc>>,
    pub unlimited_attempts: bool,
    pub one_question_at_a_time: bool,
    pub questions: Vec<QuizQuestion>,
    pub updated_at: DateTime<Utc>,
    pub is_adaptive: bool,
    /// Present for instructors when `is_adaptive` is true; omitted for learners.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adaptive_system_prompt: Option<String>,
    /// Present for instructors when `is_adaptive` is true; omitted for learners.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adaptive_source_item_ids: Option<Vec<Uuid>>,
    pub adaptive_question_count: i32,
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
    pub title: Option<String>,
    /// Omit to leave unchanged.
    #[serde(default)]
    pub markdown: Option<String>,
    /// Omit to leave unchanged.
    #[serde(default)]
    pub questions: Option<Vec<QuizQuestion>>,
    /// Omit to leave unchanged; JSON `null` clears; ISO-8601 string sets the due time.
    #[serde(default)]
    pub due_at: Option<Option<DateTime<Utc>>>,
    /// Omit to leave unchanged; JSON `null` clears.
    #[serde(default)]
    pub available_from: Option<Option<DateTime<Utc>>>,
    /// Omit to leave unchanged; JSON `null` clears.
    #[serde(default)]
    pub available_until: Option<Option<DateTime<Utc>>>,
    #[serde(default)]
    pub unlimited_attempts: Option<bool>,
    #[serde(default)]
    pub one_question_at_a_time: Option<bool>,
    #[serde(default)]
    pub is_adaptive: Option<bool>,
    #[serde(default)]
    pub adaptive_system_prompt: Option<String>,
    #[serde(default)]
    pub adaptive_source_item_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    pub adaptive_question_count: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateModuleQuizQuestionsRequest {
    pub prompt: String,
    pub question_count: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateModuleQuizQuestionsResponse {
    pub questions: Vec<QuizQuestion>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveQuizNextRequest {
    pub history: Vec<AdaptiveQuizHistoryTurn>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveQuizHistoryTurn {
    pub prompt: String,
    pub question_type: String,
    pub choices: Vec<String>,
    pub choice_weights: Vec<f64>,
    pub selected_choice_index: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveQuizGeneratedQuestion {
    pub prompt: String,
    pub question_type: String,
    pub choices: Vec<String>,
    pub choice_weights: Vec<f64>,
    pub multiple_answer: bool,
    pub answer_with_image: bool,
    pub required: bool,
    pub points: i32,
    pub estimated_minutes: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveQuizNextResponse {
    pub finished: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question: Option<AdaptiveQuizGeneratedQuestion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
