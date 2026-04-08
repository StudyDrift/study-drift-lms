use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, patch, put},
    Json, Router,
};
use serde::Deserialize;
use sqlx::Error as SqlxError;
use uuid::Uuid;

use crate::db::schema;
use crate::error::AppError;
use crate::http_auth::require_permission;
use crate::models::rbac::{
    AddRoleUserRequest, AppRole, CreatePermissionRequest, CreateRoleRequest, PatchPermissionRequest,
    PatchRoleRequest, Permission, PermissionsListResponse, RoleWithPermissions, RoleUsersResponse,
    RolesListResponse, SetRolePermissionsRequest,
};
use crate::repos::rbac;
use crate::state::AppState;

/// Settings → Roles & Permissions UI and API. Adjust assignments per role to remove access.
const PERM_RBAC_MANAGE: &str = "global:app:rbac:manage";

#[derive(Debug, Deserialize)]
struct EligibleUsersQuery {
    #[serde(default)]
    q: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/settings/permissions", get(list_permissions).post(create_permission))
        .route(
            "/api/v1/settings/permissions/{id}",
            patch(patch_permission).delete(delete_permission),
        )
        .route("/api/v1/settings/roles", get(list_roles).post(create_role))
        .route(
            "/api/v1/settings/roles/{id}",
            patch(patch_role).delete(delete_role),
        )
        .route(
            "/api/v1/settings/roles/{id}/permissions",
            put(put_role_permissions),
        )
        .route(
            "/api/v1/settings/roles/{id}/users/eligible",
            get(list_eligible_users),
        )
        .route(
            "/api/v1/settings/roles/{id}/users/{user_id}",
            delete(remove_role_user),
        )
        .route(
            "/api/v1/settings/roles/{id}/users",
            get(list_role_users).post(add_role_user),
        )
}

fn valid_role_scope(s: &str) -> bool {
    matches!(s, "global" | "course")
}

fn map_unique_violation(e: SqlxError) -> AppError {
    if let Some(db) = e.as_database_error() {
        if db.code().as_deref() == Some("23505") {
            return AppError::InvalidInput("That value already exists.".into());
        }
    }
    AppError::Db(e)
}

async fn list_permissions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PermissionsListResponse>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let permissions = rbac::list_permissions(&state.pool).await?;
    Ok(Json(PermissionsListResponse { permissions }))
}

async fn create_permission(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreatePermissionRequest>,
) -> Result<Json<Permission>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let permission_string = req.permission_string.trim();
    if permission_string.is_empty() {
        return Err(AppError::InvalidInput("Permission string is required.".into()));
    }
    rbac::validate_permission_string(permission_string).map_err(AppError::InvalidInput)?;
    let description = req.description.trim();
    let row = rbac::create_permission(&state.pool, permission_string, description)
        .await
        .map_err(map_unique_violation)?;
    Ok(Json(row))
}

async fn patch_permission(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<PatchPermissionRequest>,
) -> Result<Json<Permission>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let row = rbac::patch_permission(&state.pool, id, req.description.trim())
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn delete_permission(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let deleted = rbac::delete_permission(&state.pool, id).await?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_roles(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<RolesListResponse>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let roles = rbac::list_roles_with_permissions(&state.pool).await?;
    Ok(Json(RolesListResponse { roles }))
}

async fn create_role(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateRoleRequest>,
) -> Result<Json<RoleWithPermissions>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("Role name is required.".into()));
    }
    let description = req.description.trim();
    let mut scope = req.scope.trim();
    if scope.is_empty() {
        scope = "global";
    }
    if !valid_role_scope(scope) {
        return Err(AppError::InvalidInput(
            "Scope must be \"global\" or \"course\".".into(),
        ));
    }
    let role = rbac::create_role(&state.pool, name, description, scope)
        .await
        .map_err(map_unique_violation)?;
    Ok(Json(RoleWithPermissions {
        role,
        permissions: vec![],
    }))
}

async fn patch_role(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<PatchRoleRequest>,
) -> Result<Json<AppRole>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("Role name is required.".into()));
    }
    let description = req.description.trim();
    let mut scope = req.scope.trim();
    if scope.is_empty() {
        scope = "global";
    }
    if !valid_role_scope(scope) {
        return Err(AppError::InvalidInput(
            "Scope must be \"global\" or \"course\".".into(),
        ));
    }
    let row = rbac::patch_role(&state.pool, id, name, description, scope)
        .await
        .map_err(map_unique_violation)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn delete_role(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let deleted = rbac::delete_role(&state.pool, id).await?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn put_role_permissions(
    State(state): State<AppState>,
    Path(role_id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<SetRolePermissionsRequest>,
) -> Result<Json<RoleWithPermissions>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let exists = sqlx::query_scalar::<_, bool>(&format!(
        "SELECT EXISTS(SELECT 1 FROM {} WHERE id = $1)",
        schema::APP_ROLES
    ))
        .bind(role_id)
        .fetch_one(&state.pool)
        .await?;
    if !exists {
        return Err(AppError::NotFound);
    }
    rbac::set_role_permissions(&state.pool, role_id, &req.permission_ids).await?;
    let roles = rbac::list_roles_with_permissions(&state.pool).await?;
    let found = roles
        .into_iter()
        .find(|r| r.role.id == role_id)
        .ok_or(AppError::NotFound)?;
    Ok(Json(found))
}

async fn list_role_users(
    State(state): State<AppState>,
    Path(role_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<RoleUsersResponse>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    if !rbac::role_exists(&state.pool, role_id).await? {
        return Err(AppError::NotFound);
    }
    let users = rbac::list_users_in_role(&state.pool, role_id).await?;
    Ok(Json(RoleUsersResponse { users }))
}

async fn list_eligible_users(
    State(state): State<AppState>,
    Path(role_id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<EligibleUsersQuery>,
) -> Result<Json<RoleUsersResponse>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    if !rbac::role_exists(&state.pool, role_id).await? {
        return Err(AppError::NotFound);
    }
    let q = query.q.as_deref();
    let users = rbac::list_users_eligible_for_role(&state.pool, role_id, q).await?;
    Ok(Json(RoleUsersResponse { users }))
}

async fn add_role_user(
    State(state): State<AppState>,
    Path(role_id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<AddRoleUserRequest>,
) -> Result<StatusCode, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    if !rbac::role_exists(&state.pool, role_id).await? {
        return Err(AppError::NotFound);
    }
    if !rbac::user_exists(&state.pool, req.user_id).await? {
        return Err(AppError::NotFound);
    }
    rbac::add_user_to_role(&state.pool, role_id, req.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_role_user(
    State(state): State<AppState>,
    Path((role_id, user_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    if !rbac::role_exists(&state.pool, role_id).await? {
        return Err(AppError::NotFound);
    }
    let removed = rbac::remove_user_from_role(&state.pool, role_id, user_id).await?;
    if !removed {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
