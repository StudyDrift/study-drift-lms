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
