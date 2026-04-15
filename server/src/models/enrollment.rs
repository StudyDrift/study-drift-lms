use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::enrollment_group::EnrollmentGroupMembershipPublic;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseEnrollmentPublic {
    pub id: Uuid,
    pub user_id: Uuid,
    pub display_name: Option<String>,
    /// One of: Teacher, Instructor, Student (PascalCase for API consumers).
    pub role: String,
    /// Latest `user.user_audit.occurred_at` for this user in this course (any event kind).
    pub last_course_access_at: Option<DateTime<Utc>>,
    /// Populated when course enrollment groups are enabled.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub group_memberships: Vec<EnrollmentGroupMembershipPublic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseEnrollmentsResponse {
    pub enrollments: Vec<CourseEnrollmentPublic>,
    /// Raw enrollment roles for the authenticated user (e.g. `teacher` and `student`).
    pub viewer_enrollment_roles: Vec<String>,
    #[serde(default)]
    pub enrollment_groups_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollSelfAsStudentResponse {
    /// `true` when a new student enrollment row was created.
    pub created: bool,
}

/// PATCH `/courses/.../enrollments/{id}` — send **either** `appRoleId` or `role`, not both.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchEnrollmentRequest {
    /// Course creators only: set or replace this row as course staff with the given course-scoped app role.
    #[serde(default)]
    pub app_role_id: Option<Uuid>,
    /// Set to `"student"` to demote an `instructor` enrollment (clears per-course grants for this course).
    #[serde(default)]
    pub role: Option<String>,
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
