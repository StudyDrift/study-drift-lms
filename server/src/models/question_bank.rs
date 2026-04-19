use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionBankRowResponse {
    pub id: Uuid,
    pub course_id: Uuid,
    pub question_type: String,
    pub stem: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correct_answer: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    pub points: f64,
    pub status: String,
    pub shared: bool,
    pub source: String,
    pub metadata: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub irt_a: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub irt_b: Option<f64>,
    pub irt_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQuestionRequest {
    pub question_type: String,
    pub stem: String,
    #[serde(default)]
    pub options: Option<JsonValue>,
    #[serde(default)]
    pub correct_answer: Option<JsonValue>,
    #[serde(default)]
    pub explanation: Option<String>,
    #[serde(default)]
    pub points: Option<f64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub shared: Option<bool>,
    #[serde(default)]
    pub metadata: Option<JsonValue>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQuestionRequest {
    #[serde(default)]
    pub question_type: Option<String>,
    #[serde(default)]
    pub stem: Option<String>,
    #[serde(default)]
    pub options: Option<Option<JsonValue>>,
    #[serde(default)]
    pub correct_answer: Option<Option<JsonValue>>,
    #[serde(default)]
    pub explanation: Option<Option<String>>,
    #[serde(default)]
    pub points: Option<f64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub shared: Option<bool>,
    #[serde(default)]
    pub metadata: Option<JsonValue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionPoolResponse {
    pub id: Uuid,
    pub course_id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQuestionPoolRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPoolMembersRequest {
    pub question_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportQuestionsResponse {
    pub imported_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetQuizDeliveryRefsRequest {
    /// When `json`, clears bank refs for this quiz so delivery uses `questions_json` only.
    /// When `pool`, replaces refs with a single pool draw row.
    pub mode: String,
    #[serde(default)]
    pub pool_id: Option<Uuid>,
    #[serde(default)]
    pub sample_n: Option<i32>,
}
