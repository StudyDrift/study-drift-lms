use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyllabusSection {
    pub id: String,
    #[serde(default)]
    pub heading: String,
    #[serde(default)]
    pub markdown: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseSyllabusResponse {
    pub sections: Vec<SyllabusSection>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCourseSyllabusRequest {
    pub sections: Vec<SyllabusSection>,
}
