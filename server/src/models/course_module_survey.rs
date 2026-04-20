use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const SURVEY_QUESTION_TYPES: &[&str] = &[
    "likert",
    "rating",
    "single_select",
    "multi_select",
    "free_text",
    "net_promoter_score",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveyQuestion {
    pub id: String,
    pub subtype: String,
    pub stem: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub config: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCourseSurveyRequest {
    pub module_id: Uuid,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub anonymity_mode: String,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub questions: Vec<SurveyQuestion>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSurveyRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub anonymity_mode: Option<String>,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
    pub questions: Option<Vec<SurveyQuestion>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveyResponse {
    pub id: Uuid,
    pub course_id: Uuid,
    pub title: String,
    pub description: String,
    pub anonymity_mode: String,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
    pub questions: Vec<SurveyQuestion>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitSurveyResponseRequest {
    pub answers: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitSurveyResponse {
    pub submitted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub already_submitted: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveyQuestionResult {
    pub question_id: String,
    pub subtype: String,
    pub response_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean: Option<f64>,
    pub distribution: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveyResultsResponse {
    pub response_count: i64,
    pub questions: Vec<SurveyQuestionResult>,
}

pub fn validate_anonymity_mode(mode: &str) -> bool {
    matches!(mode, "identified" | "anonymous" | "pseudo_anonymous")
}

pub fn validate_questions(questions: &[SurveyQuestion]) -> Result<(), String> {
    if questions.len() > 200 {
        return Err("Too many survey questions (max 200).".into());
    }
    for q in questions {
        if q.id.trim().is_empty() {
            return Err("Each survey question needs an id.".into());
        }
        if q.stem.trim().is_empty() {
            return Err("Each survey question needs text.".into());
        }
        if !SURVEY_QUESTION_TYPES.iter().any(|t| *t == q.subtype) {
            return Err("Unsupported survey question type.".into());
        }
    }
    Ok(())
}
