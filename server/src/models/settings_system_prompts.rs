use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptItem {
    pub key: String,
    pub label: String,
    pub content: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptsListResponse {
    pub prompts: Vec<SystemPromptItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptUpdateRequest {
    pub content: String,
}
