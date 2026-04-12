use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentNotebookRagRequest {
    pub question: String,
    pub notebooks: Vec<StudentNotebookDocInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentNotebookDocInput {
    pub course_code: String,
    pub course_title: String,
    pub markdown: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentNotebookRagResponse {
    pub answer_markdown: String,
    pub sources: Vec<StudentNotebookRagSource>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentNotebookRagSource {
    pub course_code: String,
    pub course_title: String,
    pub excerpt: String,
}
