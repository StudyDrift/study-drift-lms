use serde::{Deserialize, Serialize};

/// POST `/api/v1/courses/{course_code}/course-context` — benign path name for LMS state sync.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostCourseContextRequest {
    /// `course_visit` — no structure item. `content_open` / `content_leave` — require `structure_item_id`.
    pub kind: String,
    #[serde(default)]
    pub structure_item_id: Option<uuid::Uuid>,
}
