use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub id: Uuid,
    pub permission_string: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AppRole {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    /// `global` or `course` (course-scoped roles are documented for per-course assignment).
    pub scope: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleWithPermissions {
    #[serde(flatten)]
    pub role: AppRole,
    pub permissions: Vec<Permission>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePermissionRequest {
    pub permission_string: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchPermissionRequest {
    pub description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoleRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_role_scope")]
    pub scope: String,
}

fn default_role_scope() -> String {
    "global".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRoleRequest {
    pub name: String,
    pub description: String,
    pub scope: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRolePermissionsRequest {
    pub permission_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsListResponse {
    pub permissions: Vec<Permission>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolesListResponse {
    pub roles: Vec<RoleWithPermissions>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UserBrief {
    pub id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub sid: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleUsersResponse {
    pub users: Vec<UserBrief>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseScopedRolesResponse {
    pub roles: Vec<AppRole>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRoleUserRequest {
    pub user_id: Uuid,
}
