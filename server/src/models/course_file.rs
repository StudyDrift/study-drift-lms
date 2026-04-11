use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct CourseFileUploadResponse {
    pub id: Uuid,
    /// Path-only URL for Markdown and `<img>`; clients join with API origin.
    pub content_path: String,
    pub mime_type: String,
    pub byte_size: i64,
}
