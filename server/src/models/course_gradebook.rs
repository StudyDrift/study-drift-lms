use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradebookGridResponse {
    pub students: Vec<CourseGradebookGridStudent>,
    pub columns: Vec<CourseGradebookGridColumn>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradebookGridStudent {
    pub user_id: Uuid,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseGradebookGridColumn {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub max_points: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_group_id: Option<Uuid>,
}
