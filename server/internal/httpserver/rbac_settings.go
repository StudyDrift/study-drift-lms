package httpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	modelrbac "github.com/lextures/lextures/server/internal/models/rbac"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

// registerSettingsRBAC mounts /api/v1/settings/... roles & permissions (Rust routes::rbac).
func (d Deps) registerSettingsRBAC(r chi.Router) {
	r.Get("/permissions", d.handleListPermissions())
	r.Post("/permissions", d.handleCreatePermission())
	r.Patch("/permissions/{id}", d.handlePatchPermission())
	r.Delete("/permissions/{id}", d.handleDeletePermission())

	r.Get("/roles", d.handleListRoles())
	r.Post("/roles", d.handleCreateRole())
	r.Patch("/roles/{id}", d.handlePatchRole())
	r.Delete("/roles/{id}", d.handleDeleteRole())
	r.Put("/roles/{id}/permissions", d.handlePutRolePermissions())

	r.Get("/roles/{id}/users/eligible", d.handleListEligibleUsers())
	r.Get("/roles/{id}/users", d.handleListRoleUsers())
	r.Post("/roles/{id}/users", d.handleAddRoleUser())
	r.Delete("/roles/{id}/users/{userId}", d.handleRemoveRoleUser())
}

func validRoleScope(s string) bool {
	switch s {
	case "global", "course":
		return true
	default:
		return false
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (d Deps) handleListPermissions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			allowGet(w, r)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		ctx := r.Context()
		perms, err := rbac.ListPermissions(ctx, d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list permissions.")
			return
		}
		if perms == nil {
			perms = []modelrbac.Permission{}
		}
		writeJSON(w, http.StatusOK, modelrbac.PermissionsListResponse{Permissions: perms})
	}
}

func (d Deps) handleCreatePermission() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var req modelrbac.CreatePermissionRequest
		if err := json.Unmarshal(b, &req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		ps := strings.TrimSpace(req.PermissionString)
		if ps == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Permission string is required.")
			return
		}
		if err := rbac.ValidatePermissionString(ps); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		ctx := r.Context()
		desc := strings.TrimSpace(req.Description)
		row, err := rbac.CreatePermission(ctx, d.Pool, ps, desc)
		if err != nil {
			if rbac.IsUniqueViolation(err) {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "That value already exists.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create permission.")
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

func (d Deps) handlePatchPermission() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var req modelrbac.PatchPermissionRequest
		if err := json.Unmarshal(b, &req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		ctx := r.Context()
		row, err := rbac.PatchPermission(ctx, d.Pool, id, strings.TrimSpace(req.Description))
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update permission.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

func (d Deps) handleDeletePermission() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		ctx := r.Context()
		deleted, err := rbac.DeletePermission(ctx, d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete permission.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleListRoles() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			allowGet(w, r)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		ctx := r.Context()
		roles, err := rbac.ListRolesWithPermissions(ctx, d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list roles.")
			return
		}
		if roles == nil {
			roles = []modelrbac.RoleWithPermissions{}
		}
		writeJSON(w, http.StatusOK, modelrbac.RolesListResponse{Roles: roles})
	}
}

func (d Deps) handleCreateRole() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var req modelrbac.CreateRoleRequest
		if err := json.Unmarshal(b, &req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Role name is required.")
			return
		}
		scope := strings.TrimSpace(req.Scope)
		if scope == "" {
			scope = "global"
		}
		if !validRoleScope(scope) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Scope must be \"global\" or \"course\".")
			return
		}
		ctx := r.Context()
		role, err := rbac.CreateRole(ctx, d.Pool, name, strings.TrimSpace(req.Description), scope)
		if err != nil {
			if rbac.IsUniqueViolation(err) {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "That value already exists.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create role.")
			return
		}
		writeJSON(w, http.StatusOK, modelrbac.RoleWithPermissions{AppRole: role, Permissions: []modelrbac.Permission{}})
	}
}

func (d Deps) handlePatchRole() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var req modelrbac.PatchRoleRequest
		if err := json.Unmarshal(b, &req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Role name is required.")
			return
		}
		scope := strings.TrimSpace(req.Scope)
		if scope == "" {
			scope = "global"
		}
		if !validRoleScope(scope) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Scope must be \"global\" or \"course\".")
			return
		}
		ctx := r.Context()
		row, err := rbac.PatchRole(ctx, d.Pool, id, name, strings.TrimSpace(req.Description), scope)
		if err != nil {
			if rbac.IsUniqueViolation(err) {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "That value already exists.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update role.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

func (d Deps) handleDeleteRole() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		ctx := r.Context()
		deleted, err := rbac.DeleteRole(ctx, d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete role.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handlePutRolePermissions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		roleID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var req modelrbac.SetRolePermissionsRequest
		if err := json.Unmarshal(b, &req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		ctx := r.Context()
		ok, err := rbac.RoleExists(ctx, d.Pool, roleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server error.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if err := rbac.SetRolePermissions(ctx, d.Pool, roleID, req.PermissionIDs); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update role permissions.")
			return
		}
		full, err := rbac.GetRoleWithPermissions(ctx, d.Pool, roleID)
		if err != nil || full == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load role.")
			return
		}
		writeJSON(w, http.StatusOK, full)
	}
}

func (d Deps) handleListRoleUsers() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			allowGet(w, r)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		roleID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		ctx := r.Context()
		ok, err := rbac.RoleExists(ctx, d.Pool, roleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server error.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		users, err := rbac.ListUsersInRole(ctx, d.Pool, roleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list users.")
			return
		}
		if users == nil {
			users = []modelrbac.UserBrief{}
		}
		writeJSON(w, http.StatusOK, modelrbac.RoleUsersResponse{Users: users})
	}
}

func (d Deps) handleListEligibleUsers() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			allowGet(w, r)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		roleID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		ctx := r.Context()
		ok, err := rbac.RoleExists(ctx, d.Pool, roleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server error.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var q *string
		if s := r.URL.Query().Get("q"); s != "" {
			q = &s
		}
		users, err := rbac.ListUsersEligibleForRole(ctx, d.Pool, roleID, q)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list users.")
			return
		}
		if users == nil {
			users = []modelrbac.UserBrief{}
		}
		writeJSON(w, http.StatusOK, modelrbac.RoleUsersResponse{Users: users})
	}
}

func (d Deps) handleAddRoleUser() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		roleID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var req modelrbac.AddRoleUserRequest
		if err := json.Unmarshal(b, &req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		ctx := r.Context()
		roleOK, err := rbac.RoleExists(ctx, d.Pool, roleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server error.")
			return
		}
		if !roleOK {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		exists, err := rbac.UserExists(ctx, d.Pool, req.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server error.")
			return
		}
		if !exists {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if err := rbac.AddUserToRole(ctx, d.Pool, roleID, req.UserID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to add user to role.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleRemoveRoleUser() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		roleID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		userID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid user id.")
			return
		}
		ctx := r.Context()
		roleOK, err := rbac.RoleExists(ctx, d.Pool, roleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server error.")
			return
		}
		if !roleOK {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		removed, err := rbac.RemoveUserFromRole(ctx, d.Pool, roleID, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to remove user from role.")
			return
		}
		if !removed {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func allowGet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Allow", http.MethodGet)
	http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
}

func (d Deps) registerSettingsRoutes(r chi.Router) {
	r.Get("/api/v1/settings/account", d.handleGetSettingsAccount())
	r.Patch("/api/v1/settings/account", d.handlePatchSettingsAccount())
	r.Get("/api/v1/settings/ai/models", d.handleListAIModels())
	r.Get("/api/v1/settings/ai", d.handleGetSettingsAI())
	r.Put("/api/v1/settings/ai", d.handlePutSettingsAI())
	r.Get("/api/v1/settings/platform", d.handleGetPlatformSettings())
	r.Put("/api/v1/settings/platform", d.handlePutPlatformSettings())
	r.Get("/api/v1/settings/system-prompts", d.handleListSystemPrompts())
	r.Put("/api/v1/settings/system-prompts/{key}", d.handlePutSystemPrompt())
	r.Route("/api/v1/settings", func(s chi.Router) { d.registerSettingsRBAC(s) })
}
