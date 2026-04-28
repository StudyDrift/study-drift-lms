// Package rbac contains JSON DTOs for the settings roles/permissions API (Rust server/src/models/rbac.rs).
package rbac

import (
	"time"

	"github.com/google/uuid"
)

// Permission is a row in "user".permissions.
type Permission struct {
	ID                 uuid.UUID `json:"id"`
	PermissionString  string    `json:"permissionString"`
	Description       string    `json:"description"`
	CreatedAt         time.Time `json:"createdAt"`
}

// AppRole is a row in "user".app_roles.
type AppRole struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Scope       string    `json:"scope"`
	CreatedAt   time.Time `json:"createdAt"`
}

// RoleWithPermissions is the app role with its permission rows (JSON shape uses flattened role fields).
type RoleWithPermissions struct {
	AppRole
	Permissions []Permission `json:"permissions"`
}

// UserBrief is a minimal user for role membership lists.
type UserBrief struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"displayName"`
	Sid         *string   `json:"sid"`
}

// CreatePermissionRequest is the body for POST /api/v1/settings/permissions.
type CreatePermissionRequest struct {
	PermissionString string `json:"permissionString"`
	Description      string `json:"description"`
}

// PatchPermissionRequest is the body for PATCH /api/v1/settings/permissions/{id}.
type PatchPermissionRequest struct {
	Description string `json:"description"`
}

// CreateRoleRequest is the body for POST /api/v1/settings/roles.
type CreateRoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Scope       string `json:"scope"`
}

// PatchRoleRequest is the body for PATCH /api/v1/settings/roles/{id}.
type PatchRoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Scope       string `json:"scope"`
}

// SetRolePermissionsRequest is the body for PUT /api/v1/settings/roles/{id}/permissions.
type SetRolePermissionsRequest struct {
	PermissionIDs []uuid.UUID `json:"permissionIds"`
}

// AddRoleUserRequest is the body for POST /api/v1/settings/roles/{id}/users.
type AddRoleUserRequest struct {
	UserID uuid.UUID `json:"userId"`
}

// PermissionsListResponse is GET /api/v1/settings/permissions.
type PermissionsListResponse struct {
	Permissions []Permission `json:"permissions"`
}

// RolesListResponse is GET /api/v1/settings/roles.
type RolesListResponse struct {
	Roles []RoleWithPermissions `json:"roles"`
}

// RoleUsersResponse is user lists under a role.
type RoleUsersResponse struct {
	Users []UserBrief `json:"users"`
}
