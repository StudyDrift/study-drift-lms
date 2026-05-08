package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/orgrolegrant"
	"github.com/lextures/lextures/server/internal/repos/orgunit"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

func (d Deps) parseOrgIDParam(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	s := strings.TrimSpace(chi.URLParam(r, "orgId"))
	id, err := uuid.Parse(s)
	if err != nil {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
		return uuid.UUID{}, false
	}
	return id, true
}

func (d Deps) userBelongsToOrgOrGlobal(ctx context.Context, w http.ResponseWriter, userID, orgID uuid.UUID) (globalAdmin bool, ok bool) {
	ga, err := rbac.UserHasPermission(ctx, d.Pool, userID, permGlobalRBACManage)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return false, false
	}
	if ga {
		return true, true
	}
	uOrg, err := organization.OrgIDForUser(ctx, d.Pool, userID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify organization.")
		return false, false
	}
	if uOrg != orgID {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return false, false
	}
	return false, true
}

func (d Deps) handleMeOrgRoleCapabilities() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		orgID, err := organization.OrgIDForUser(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load organization.")
			return
		}
		ga, err := rbac.UserHasPermission(ctx, d.Pool, userID, permGlobalRBACManage)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		canManage, err := orgrolegrant.CanManageOrgRoleGrants(ctx, d.Pool, userID, orgID, ga)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify org roles.")
			return
		}
		access, err := orgrolegrant.ResolveOrgCourseAccess(ctx, d.Pool, userID, orgID, ga)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify org roles.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"orgId":                   orgID.String(),
			"canManageOrgRoleGrants":  canManage,
			"canListOrgCourseCatalog": access != orgrolegrant.OrgCourseAccessNone,
		})
	}
}

func (d Deps) handleOrgCoursesCatalog() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		orgID, ok := d.parseOrgIDParam(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		globalAdmin, ok := d.userBelongsToOrgOrGlobal(ctx, w, userID, orgID)
		if !ok {
			return
		}
		access, accessErr := orgrolegrant.ResolveOrgCourseAccess(ctx, d.Pool, userID, orgID, globalAdmin)
		if accessErr != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to resolve org course access.")
			return
		}
		if access == orgrolegrant.OrgCourseAccessNone {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		var list []course.CoursePublic
		var listErr error
		switch access {
		case orgrolegrant.OrgCourseAccessAllInOrg:
			list, listErr = course.ListPublicInOrg(ctx, d.Pool, orgID)
		case orgrolegrant.OrgCourseAccessSubtree:
			var subtrees []uuid.UUID
			subtrees, listErr = orgunit.ListSubtreeIDsForUserOrgUnitAdmin(ctx, d.Pool, userID, orgID)
			if listErr != nil {
				break
			}
			list, listErr = course.ListPublicInOrgWithinOrgUnits(ctx, d.Pool, orgID, subtrees, false)
		default:
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		if listErr != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
			return
		}
		if list == nil {
			list = []course.CoursePublic{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"courses": list})
	}
}

type postOrgRoleGrantBody struct {
	UserID    string  `json:"userId"`
	Role      string  `json:"role"`
	OrgUnitID *string `json:"orgUnitId"`
	ExpiresAt *string `json:"expiresAt"`
}

func (d Deps) handleOrgRoleGrantsCollection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orgID, ok := d.parseOrgIDParam(w, r)
		if !ok {
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		globalAdmin, ok := d.userBelongsToOrgOrGlobal(ctx, w, userID, orgID)
		if !ok {
			return
		}
		switch r.Method {
		case http.MethodGet:
			can, err := orgrolegrant.CanManageOrgRoleGrants(ctx, d.Pool, userID, orgID, globalAdmin)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
				return
			}
			if !can {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
				return
			}
			if _, err := orgrolegrant.DeleteExpired(ctx, d.Pool); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to prune expired grants.")
				return
			}
			rows, err := orgrolegrant.ListByOrg(ctx, d.Pool, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list org role grants.")
				return
			}
			out := make([]map[string]any, 0, len(rows))
			for _, g := range rows {
				m := map[string]any{
					"id":        g.ID.String(),
					"orgId":     g.OrgID.String(),
					"userId":    g.UserID.String(),
					"role":      g.Role,
					"grantedBy": g.GrantedBy.String(),
					"grantedAt": g.GrantedAt.UTC().Format(time.RFC3339Nano),
				}
				if g.OrgUnitID != nil {
					m["orgUnitId"] = g.OrgUnitID.String()
				} else {
					m["orgUnitId"] = nil
				}
				if g.ExpiresAt != nil {
					m["expiresAt"] = g.ExpiresAt.UTC().Format(time.RFC3339Nano)
				} else {
					m["expiresAt"] = nil
				}
				out = append(out, m)
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{"grants": out})
		case http.MethodPost:
			can, err := orgrolegrant.CanManageOrgRoleGrants(ctx, d.Pool, userID, orgID, globalAdmin)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
				return
			}
			if !can {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
				return
			}
			var body postOrgRoleGrantBody
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			target, err := uuid.Parse(strings.TrimSpace(body.UserID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid userId.")
				return
			}
			role := strings.TrimSpace(body.Role)
			if role == orgrolegrant.RoleOrgAdmin && !globalAdmin {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only a platform administrator can assign the org admin role.")
				return
			}
			var unit *uuid.UUID
			if body.OrgUnitID != nil && strings.TrimSpace(*body.OrgUnitID) != "" {
				u, err := uuid.Parse(strings.TrimSpace(*body.OrgUnitID))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid orgUnitId.")
					return
				}
				unit = &u
			}
			var exp *time.Time
			if body.ExpiresAt != nil && strings.TrimSpace(*body.ExpiresAt) != "" {
				t, err := time.Parse(time.RFC3339, strings.TrimSpace(*body.ExpiresAt))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid expiresAt (use RFC3339).")
					return
				}
				exp = &t
			}
			row, err := orgrolegrant.Insert(ctx, d.Pool, orgID, target, role, userID, unit, exp)
			if err != nil {
				if strings.Contains(err.Error(), "duplicate grant") {
					apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, err.Error())
					return
				}
				if strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "must") || strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "belong") {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create org role grant.")
				return
			}
			grantJSON := map[string]any{
				"id":        row.ID.String(),
				"orgId":     row.OrgID.String(),
				"userId":    row.UserID.String(),
				"role":      row.Role,
				"grantedBy": row.GrantedBy.String(),
				"grantedAt": row.GrantedAt.UTC().Format(time.RFC3339Nano),
			}
			if row.OrgUnitID != nil {
				grantJSON["orgUnitId"] = row.OrgUnitID.String()
			} else {
				grantJSON["orgUnitId"] = nil
			}
			if row.ExpiresAt != nil {
				grantJSON["expiresAt"] = row.ExpiresAt.UTC().Format(time.RFC3339Nano)
			} else {
				grantJSON["expiresAt"] = nil
			}
			_ = organization.InsertAudit(ctx, d.Pool, userID, orgID, "role_granted", map[string]any{
				"targetUserId": target.String(),
				"role":         role,
				"grantId":      row.ID.String(),
			})
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"grant": grantJSON})
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

func (d Deps) handleOrgRoleGrantItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgID, ok := d.parseOrgIDParam(w, r)
		if !ok {
			return
		}
		gidStr := strings.TrimSpace(chi.URLParam(r, "grantId"))
		gid, err := uuid.Parse(gidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid grant id.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		globalAdmin, ok := d.userBelongsToOrgOrGlobal(ctx, w, userID, orgID)
		if !ok {
			return
		}
		can, err := orgrolegrant.CanManageOrgRoleGrants(ctx, d.Pool, userID, orgID, globalAdmin)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		var targetUser uuid.UUID
		var roleName string
		qerr := d.Pool.QueryRow(ctx, `
SELECT user_id, role FROM tenant.org_role_grants WHERE id = $1 AND org_id = $2
`, gid, orgID).Scan(&targetUser, &roleName)
		if errors.Is(qerr, pgx.ErrNoRows) {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if qerr != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load grant.")
			return
		}
		deleted, err := orgrolegrant.DeleteByID(ctx, d.Pool, orgID, gid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to revoke grant.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		_ = organization.InsertAudit(ctx, d.Pool, userID, orgID, "role_revoked", map[string]any{
			"targetUserId": targetUser.String(),
			"role":         roleName,
			"grantId":      gid.String(),
		})
		w.WriteHeader(http.StatusNoContent)
	}
}
