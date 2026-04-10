use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseEnrollmentPublic {
    pub id: Uuid,
    pub user_id: Uuid,
    pub display_name: Option<String>,
    /// One of: Teacher, Instructor, Student (PascalCase for API consumers).
    pub role: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseEnrollmentsResponse {
    pub enrollments: Vec<CourseEnrollmentPublic>,
    /// Raw enrollment roles for the authenticated user (e.g. `teacher` and `student`).
    pub viewer_enrollment_roles: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollSelfAsStudentResponse {
    /// `true` when a new student enrollment row was created.
    pub created: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEnrollmentsRequest {
    /// Comma-, semicolon-, newline-, or space-separated email addresses.
    pub emails: String,
    /// Course creators must set this to a course-scoped `app_roles` row. Omitted for student-only adds (non-creators).
    #[serde(default)]
    pub app_role_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEnrollmentsResponse {
    pub added: Vec<String>,
    pub already_enrolled: Vec<String>,
    pub not_found: Vec<String>,
}
