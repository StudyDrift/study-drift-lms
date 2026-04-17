use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::models::late_submission_policy::validate_late_submission_policy_pair;

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

pub const GRADE_ATTEMPT_POLICIES: &[&str] = &["highest", "latest", "first", "average"];
pub const SHOW_SCORE_TIMINGS: &[&str] = &["immediate", "after_due", "manual"];
pub const REVIEW_VISIBILITIES: &[&str] =
    &["none", "score_only", "responses", "correct_answers", "full"];
pub const REVIEW_WHENS: &[&str] = &["after_submit", "after_due", "always", "never"];
pub const ADAPTIVE_DIFFICULTIES: &[&str] = &["introductory", "standard", "challenging"];
pub const ADAPTIVE_STOP_RULES: &[&str] = &["fixed_count", "mastery_estimate"];

pub const MAX_QUIZ_ACCESS_CODE_LEN: usize = 128;
pub const MIN_MAX_ATTEMPTS: i32 = 1;
pub const MAX_MAX_ATTEMPTS: i32 = 100;
pub const MAX_ITEM_POINTS_WORTH: i32 = 1_000_000;

pub fn validate_item_points_worth(points_worth: Option<i32>) -> Result<(), AppError> {
    if let Some(p) = points_worth {
        if !(0..=MAX_ITEM_POINTS_WORTH).contains(&p) {
            return Err(AppError::InvalidInput(format!(
                "pointsWorth must be between 0 and {MAX_ITEM_POINTS_WORTH}."
            )));
        }
    }
    Ok(())
}

pub fn validate_quiz_comprehensive_settings(
    unlimited_attempts: bool,
    max_attempts: i32,
    grade_attempt_policy: &str,
    passing_score_percent: Option<i32>,
    late_submission_policy: &str,
    late_penalty_percent: Option<i32>,
    time_limit_minutes: Option<i32>,
    per_question_time_limit_seconds: Option<i32>,
    show_score_timing: &str,
    review_visibility: &str,
    review_when: &str,
    adaptive_difficulty: &str,
    adaptive_stop_rule: &str,
    random_question_pool_count: Option<i32>,
    quiz_access_code: Option<&str>,
) -> Result<(), AppError> {
    let grade_attempt_policy = grade_attempt_policy.trim();
    let late_submission_policy = late_submission_policy.trim();
    let show_score_timing = show_score_timing.trim();
    let review_visibility = review_visibility.trim();
    let review_when = review_when.trim();
    let adaptive_difficulty = adaptive_difficulty.trim();
    let adaptive_stop_rule = adaptive_stop_rule.trim();

    if !GRADE_ATTEMPT_POLICIES.contains(&grade_attempt_policy) {
        return Err(AppError::InvalidInput(
            "gradeAttemptPolicy must be one of: highest, latest, first, average.".into(),
        ));
    }
    validate_late_submission_policy_pair(late_submission_policy, late_penalty_percent)?;
    if !SHOW_SCORE_TIMINGS.contains(&show_score_timing) {
        return Err(AppError::InvalidInput(
            "showScoreTiming must be one of: immediate, after_due, manual.".into(),
        ));
    }
    if !REVIEW_VISIBILITIES.contains(&review_visibility) {
        return Err(AppError::InvalidInput(
            "reviewVisibility must be one of: none, score_only, responses, correct_answers, full."
                .into(),
        ));
    }
    if !REVIEW_WHENS.contains(&review_when) {
        return Err(AppError::InvalidInput(
            "reviewWhen must be one of: after_submit, after_due, always, never.".into(),
        ));
    }
    if !ADAPTIVE_DIFFICULTIES.contains(&adaptive_difficulty) {
        return Err(AppError::InvalidInput(
            "adaptiveDifficulty must be one of: introductory, standard, challenging.".into(),
        ));
    }
    if !ADAPTIVE_STOP_RULES.contains(&adaptive_stop_rule) {
        return Err(AppError::InvalidInput(
            "adaptiveStopRule must be one of: fixed_count, mastery_estimate.".into(),
        ));
    }
    if !unlimited_attempts {
        if max_attempts < MIN_MAX_ATTEMPTS || max_attempts > MAX_MAX_ATTEMPTS {
            return Err(AppError::InvalidInput(format!(
                "maxAttempts must be between {MIN_MAX_ATTEMPTS} and {MAX_MAX_ATTEMPTS} when unlimitedAttempts is false."
            )));
        }
    }
    if let Some(p) = passing_score_percent {
        if !(0..=100).contains(&p) {
            return Err(AppError::InvalidInput(
                "passingScorePercent must be between 0 and 100.".into(),
            ));
        }
    }
    if let Some(m) = time_limit_minutes {
        if !(1..=10080).contains(&m) {
            return Err(AppError::InvalidInput(
                "timeLimitMinutes must be between 1 and 10080.".into(),
            ));
        }
    }
    if let Some(s) = per_question_time_limit_seconds {
        if !(10..=86400).contains(&s) {
            return Err(AppError::InvalidInput(
                "perQuestionTimeLimitSeconds must be between 10 and 86400.".into(),
            ));
        }
    }
    if let Some(n) = random_question_pool_count {
        if !(1..=300).contains(&n) {
            return Err(AppError::InvalidInput(
                "randomQuestionPoolCount must be between 1 and 300.".into(),
            ));
        }
    }
    if let Some(code) = quiz_access_code {
        if code.len() > MAX_QUIZ_ACCESS_CODE_LEN {
            return Err(AppError::InvalidInput(
                "quizAccessCode is too long (max 128 characters).".into(),
            ));
        }
    }
    Ok(())
}

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

pub fn sanitize_quiz_questions_for_learner(mut questions: Vec<QuizQuestion>) -> Vec<QuizQuestion> {
    for q in &mut questions {
        q.correct_choice_index = None;
    }
    questions
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
            return Err(AppError::InvalidInput(
                "Unsupported quiz question type.".into(),
            ));
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
    pub max_attempts: i32,
    pub grade_attempt_policy: String,
    pub passing_score_percent: Option<i32>,
    pub points_worth: Option<i32>,
    pub late_submission_policy: String,
    pub late_penalty_percent: Option<i32>,
    pub time_limit_minutes: Option<i32>,
    pub timer_pause_when_tab_hidden: bool,
    pub per_question_time_limit_seconds: Option<i32>,
    pub show_score_timing: String,
    pub review_visibility: String,
    pub review_when: String,
    pub one_question_at_a_time: bool,
    pub shuffle_questions: bool,
    pub shuffle_choices: bool,
    pub allow_back_navigation: bool,
    /// True when a non-empty access code is configured (learners see this without the code).
    pub requires_quiz_access_code: bool,
    /// Only included for course editors who can view secrets.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quiz_access_code: Option<String>,
    pub adaptive_difficulty: String,
    pub adaptive_topic_balance: bool,
    pub adaptive_stop_rule: String,
    pub random_question_pool_count: Option<i32>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_group_id: Option<Uuid>,
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
    pub max_attempts: Option<i32>,
    #[serde(default)]
    pub grade_attempt_policy: Option<String>,
    #[serde(default)]
    pub passing_score_percent: Option<Option<i32>>,
    /// Omit unchanged; JSON `null` clears.
    #[serde(default)]
    pub points_worth: Option<Option<i32>>,
    #[serde(default)]
    pub late_submission_policy: Option<String>,
    #[serde(default)]
    pub late_penalty_percent: Option<Option<i32>>,
    #[serde(default)]
    pub time_limit_minutes: Option<Option<i32>>,
    #[serde(default)]
    pub timer_pause_when_tab_hidden: Option<bool>,
    #[serde(default)]
    pub per_question_time_limit_seconds: Option<Option<i32>>,
    #[serde(default)]
    pub show_score_timing: Option<String>,
    #[serde(default)]
    pub review_visibility: Option<String>,
    #[serde(default)]
    pub review_when: Option<String>,
    #[serde(default)]
    pub shuffle_questions: Option<bool>,
    #[serde(default)]
    pub shuffle_choices: Option<bool>,
    #[serde(default)]
    pub allow_back_navigation: Option<bool>,
    /// Omit unchanged; JSON null clears the code.
    #[serde(default)]
    pub quiz_access_code: Option<Option<String>>,
    #[serde(default)]
    pub adaptive_difficulty: Option<String>,
    #[serde(default)]
    pub adaptive_topic_balance: Option<bool>,
    #[serde(default)]
    pub adaptive_stop_rule: Option<String>,
    #[serde(default)]
    pub random_question_pool_count: Option<Option<i32>>,
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
    /// Required for learners taking a stored attempt; omitted for instructor preview.
    #[serde(default)]
    pub attempt_id: Option<Uuid>,
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
    /// Per-question point value (usually from the generated question). Used when submitting an attempt.
    #[serde(default)]
    pub points: Option<i32>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub questions: Vec<AdaptiveQuizGeneratedQuestion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizStartRequest {
    #[serde(default)]
    pub quiz_access_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizStartResponse {
    pub attempt_id: Uuid,
    pub attempt_number: i32,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizQuestionResponseItem {
    pub question_id: String,
    #[serde(default)]
    pub selected_choice_index: Option<usize>,
    #[serde(default)]
    pub selected_choice_indices: Option<Vec<usize>>,
    #[serde(default)]
    pub text_answer: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizSubmitRequest {
    pub attempt_id: Uuid,
    #[serde(default)]
    pub responses: Option<Vec<QuizQuestionResponseItem>>,
    #[serde(default)]
    pub adaptive_history: Option<Vec<AdaptiveQuizHistoryTurn>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizSubmitResponse {
    pub attempt_id: Uuid,
    pub points_earned: f64,
    pub points_possible: f64,
    pub score_percent: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizResultsScoreSummary {
    pub points_earned: f64,
    pub points_possible: f64,
    pub score_percent: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizResultsQuestionResult {
    pub question_index: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question_id: Option<String>,
    pub question_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_snapshot: Option<String>,
    pub response_json: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_correct: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points_awarded: Option<f64>,
    pub max_points: f64,
    /// Present when review policy allows and the item is non-adaptive.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correct_choice_index: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizResultsResponse {
    pub attempt_id: Uuid,
    pub attempt_number: i32,
    pub started_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<DateTime<Utc>>,
    pub status: String,
    pub is_adaptive: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<QuizResultsScoreSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub questions: Option<Vec<QuizResultsQuestionResult>>,
}
