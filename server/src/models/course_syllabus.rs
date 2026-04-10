use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

fn bool_is_false(b: &bool) -> bool {
    !*b
}

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
    pub require_syllabus_acceptance: bool,
    /// When true, the current user still needs to acknowledge (students only).
    #[serde(skip_serializing_if = "bool_is_false")]
    pub syllabus_acceptance_pending: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyllabusAcceptanceStatusResponse {
    pub require_syllabus_acceptance: bool,
    pub has_accepted_syllabus: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCourseSyllabusRequest {
    pub sections: Vec<SyllabusSection>,
    #[serde(default)]
    pub require_syllabus_acceptance: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSyllabusSectionRequest {
    pub instructions: String,
    #[serde(default)]
    pub section_heading: String,
    #[serde(default)]
    pub existing_markdown: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSyllabusSectionResponse {
    pub markdown: String,
}
