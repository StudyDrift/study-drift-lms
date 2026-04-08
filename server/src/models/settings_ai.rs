use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsUpdateRequest {
    pub image_model_id: String,
    pub course_setup_model_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsResponse {
    pub image_model_id: String,
    pub course_setup_model_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelOption {
    pub id: String,
    pub name: String,
    pub context_length: Option<u64>,
    pub input_price_per_million_usd: Option<f64>,
    pub output_price_per_million_usd: Option<f64>,
    /// e.g. `text+image -> image+text` from OpenRouter `architecture` modalities.
    pub modalities_summary: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelsListResponse {
    pub configured: bool,
    pub models: Vec<AiModelOption>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateCourseImageRequest {
    pub prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateCourseImageResponse {
    pub image_url: String,
}
