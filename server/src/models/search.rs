use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCourseItem {
    pub course_code: String,
    pub title: String,
    pub notebook_enabled: bool,
    pub feed_enabled: bool,
    pub calendar_enabled: bool,
    #[serde(default)]
    pub question_bank_enabled: bool,
    #[serde(default)]
    pub lockdown_mode_enabled: bool,
    pub standards_alignment_enabled: bool,
    #[serde(default)]
    pub adaptive_paths_enabled: bool,
    #[serde(default)]
    pub srs_enabled: bool,
    #[serde(default)]
    pub diagnostic_assessments_enabled: bool,
    pub hint_scaffolding_enabled: bool,
    #[serde(default)]
    pub misconception_detection_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPersonItem {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub role: String,
    pub course_code: String,
    pub course_title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexResponse {
    pub courses: Vec<SearchCourseItem>,
    pub people: Vec<SearchPersonItem>,
}
