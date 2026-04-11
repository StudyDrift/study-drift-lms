use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPageMarkupResponse {
    pub id: Uuid,
    pub kind: String,
    pub quote_text: String,
    pub notebook_page_id: Option<String>,
    pub comment_text: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPageMarkupsListResponse {
    pub markups: Vec<ContentPageMarkupResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateContentPageMarkupRequest {
    pub kind: String,
    pub quote_text: String,
    #[serde(default)]
    pub notebook_page_id: Option<String>,
    #[serde(default)]
    pub comment_text: Option<String>,
}
