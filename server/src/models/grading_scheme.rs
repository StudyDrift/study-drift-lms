use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradingSchemeResponse {
    pub id: Uuid,
    pub name: String,
    #[serde(rename = "type")]
    pub scheme_type: String,
    pub scale_json: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradingSchemeEnvelope {
    pub scheme: Option<GradingSchemeResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutGradingSchemeRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub scheme_type: String,
    pub scale_json: Option<Value>,
}
