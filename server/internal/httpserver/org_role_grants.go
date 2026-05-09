package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/orgroles"
	"github.com/lextures/lextures/server/internal/repos/orgunit"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

type orgRoleGrantJSON struct {
	ID         string  `json:"id"`
	OrgID      string  `json:"orgId"`
	UserID     string  `json:"userId"`
	UserEmail  string  `json:"userEmail"`
	DisplayName *string `json:"displayName"`
	OrgUnitID  *string `json:"orgUnitId"`
	OrgUnitName *string `json:"orgUnitName"`
	Role       string  `json:"role"`
	GrantedBy  *string `json:"grantedBy"`
	GrantedAt  string  `json:"grantedAt"`
	ExpiresAt  *string `json:"expiresAt"`
}

func (d Deps) orgRoleAccess(w http.ResponseWriter, r *http.Request, orgID uuid.UUID, wantManage bool) (actor uuid.UUID, ok bool) {
	actor, ok = d.meUserID(w, r)
	if !ok {
		return uuid.UUID{}, false
	}
	ctx := r.Context()
	ga, err := rbac.UserHasPermission(ctx, d.Pool, actor, permGlobalRBACManage)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.UUID{}, false
	}
	if ga {
		return actor, true
	}
	uOrg, err := organization.OrgIDForUser(ctx, d.Pool, actor)
	if err != nil || uOrg != orgID {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return uuid.UUID{}, false
	}
	if wantManage {
		has, err := orgroles.UserHasRole(ctx, d.Pool, actor, orgID, orgroles.RoleOrgAdmin)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return uuid.UUID{}, false
		}
		if !has {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return uuid.UUID{}, false
		}
		return actor, true
	}
	admin, err := orgroles.UserHasRole(ctx, d.Pool, actor, orgID, orgroles.RoleOrgAdmin)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.UUID{}, false
	}
	if admin {
		return actor, true
	}
	viewer, err := orgroles.UserHasRole(ctx, d.Pool, actor, orgID, orgroles.RoleOrgViewer)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.UUID{}, false
	}
	if !viewer {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return uuid.UUID{}, false
	}
	return actor, true
}

// GET /api/v1/orgs/{orgId}/role-grants
// POST /api/v1/orgs/{orgId}/role-grants
func (d Deps) handleOrgRoleGrantsCollection() http.HandlerFunc {
	type postBody struct {
		UserID    string  `json:"user_id"`
		Role      string  `json:"role"`
		OrgUnitID *string `json:"org_unit_id"`
		ExpiresAt *string `json:"expires_at"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		orgID, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "orgId")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		switch r.Method {
		case http.MethodGet:
			if _, ok := d.orgRoleAccess(w, r, orgID, false); !ok {
				return
			}
			rows, err := d.Pool.Query(r.Context(), `
SELECT g.id, g.org_id, g.user_id, u.email, u.display_name,
       g.org_unit_id, ou.name,
       g.role, g.granted_by, g.granted_at, g.expires_at
FROM "user".org_role_grants g
INNER JOIN "user".users u ON u.id = g.user_id
LEFT JOIN tenant.org_units ou ON ou.id = g.org_unit_id
WHERE g.org_id = $1
ORDER BY g.granted_at DESC
`, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list org roles.")
				return
			}
			defer rows.Close()
			var out []orgRoleGrantJSON
			for rows.Next() {
				var id, oid, uid uuid.UUID
				var email string
				var dn *string
				var unitID *uuid.UUID
				var unitName *string
				var role string
				var grantedBy *uuid.UUID
				var grantedAt time.Time
				var expiresAt *time.Time
				if err := rows.Scan(&id, &oid, &uid, &email, &dn, &unitID, &unitName, &role, &grantedBy, &grantedAt, &expiresAt); err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list org roles.")
					return
				}
				var unitIDStr *string
				if unitID != nil {
					s := unitID.String()
					unitIDStr = &s
				}
				var gb *string
				if grantedBy != nil {
					s := grantedBy.String()
					gb = &s
				}
				var exp *string
				if expiresAt != nil {
					s := expiresAt.UTC().Format(time.RFC3339Nano)
					exp = &s
				}
				out = append(out, orgRoleGrantJSON{
					ID:          id.String(),
					OrgID:       oid.String(),
					UserID:      uid.String(),
					UserEmail:   email,
					DisplayName: dn,
					OrgUnitID:   unitIDStr,
					OrgUnitName: unitName,
					Role:        role,
					GrantedBy:   gb,
					GrantedAt:   grantedAt.UTC().Format(time.RFC3339Nano),
					ExpiresAt:   exp,
				})
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{"grants": out})
		case http.MethodPost:
			actor, ok := d.orgRoleAccess(w, r, orgID, true)
			if !ok {
				return
			}
			var body postBody
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			targetUser, err := uuid.Parse(strings.TrimSpace(body.UserID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid user_id.")
				return
			}
			role := strings.TrimSpace(body.Role)
			if role != string(orgroles.RoleOrgAdmin) && role != string(orgroles.RoleOrgUnitAdmin) && role != string(orgroles.RoleOrgViewer) {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid role.")
				return
			}
			// Target user must belong to org.
			uOrg, err := organization.OrgIDForUser(r.Context(), d.Pool, targetUser)
			if err != nil {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "User not found.")
				return
			}
			if uOrg != orgID {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "User must belong to the same organization.")
				return
			}
			// Only platform admins can grant org_admin.
			if role == string(orgroles.RoleOrgAdmin) {
				ga, err := rbac.UserHasPermission(r.Context(), d.Pool, actor, permGlobalRBACManage)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
					return
				}
				if !ga {
					apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only a platform admin can grant org admin.")
					return
				}
			}
			var unitID *uuid.UUID
			if role == string(orgroles.RoleOrgUnitAdmin) {
				if body.OrgUnitID == nil || strings.TrimSpace(*body.OrgUnitID) == "" {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "org_unit_id is required for org_unit_admin.")
					return
				}
				id, err := uuid.Parse(strings.TrimSpace(*body.OrgUnitID))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid org_unit_id.")
					return
				}
				unit, err := orgunit.GetByID(r.Context(), d.Pool, id)
				if err != nil || unit == nil || unit.OrgID != orgID {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid org unit.")
					return
				}
				unitID = &id
			}
			var exp *time.Time
			if body.ExpiresAt != nil && strings.TrimSpace(*body.ExpiresAt) != "" {
				tm, err := time.Parse(time.RFC3339, strings.TrimSpace(*body.ExpiresAt))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid expires_at (use RFC3339).")
					return
				}
				utc := tm.UTC()
				exp = &utc
			}
			actorPtr := actor
			g, err := orgroles.Create(r.Context(), d.Pool, orgID, targetUser, unitID, orgroles.Role(role), &actorPtr, exp)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to grant role.")
				return
			}
			// Mirror org_unit_admin into existing permission model.
			if role == string(orgroles.RoleOrgUnitAdmin) && unitID != nil {
				_ = orgunit.AssignOrgUnitAdmin(r.Context(), d.Pool, targetUser, *unitID)
				_ = rbac.AssignUserRoleByName(r.Context(), d.Pool, targetUser, "Org Unit Admin")
			}
			// Audit event.
			_, _ = d.Pool.Exec(r.Context(), `
INSERT INTO tenant.organization_audit_events (actor_id, org_id, action, payload)
VALUES ($1, $2, 'org_role_granted', jsonb_build_object(
  'grant_id', $3,
  'target_user_id', $4,
  'role', $5,
  'org_unit_id', $6,
  'expires_at', $7
))
`, actor, orgID, g.ID, targetUser, role, unitID, exp)

			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": g.ID.String()})
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

// DELETE /api/v1/orgs/{orgId}/role-grants/{gid}
func (d Deps) handleOrgRoleGrantDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgID, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "orgId")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		actor, ok := d.orgRoleAccess(w, r, orgID, true)
		if !ok {
			return
		}
		gid, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "gid")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid grant id.")
			return
		}
		// Load before delete so we can enforce org_admin revocation rules.
		var role string
		err = d.Pool.QueryRow(r.Context(), `SELECT role FROM "user".org_role_grants WHERE id = $1 AND org_id = $2`, gid, orgID).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to revoke role.")
			return
		}
		if role == string(orgroles.RoleOrgAdmin) {
			ga, err := rbac.UserHasPermission(r.Context(), d.Pool, actor, permGlobalRBACManage)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
				return
			}
			if !ga {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only a platform admin can revoke org admin.")
				return
			}
		}
		deleted, err := orgroles.DeleteByID(r.Context(), d.Pool, orgID, gid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to revoke role.")
			return
		}
		if deleted == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		// Audit event.
		_, _ = d.Pool.Exec(r.Context(), `
INSERT INTO tenant.organization_audit_events (actor_id, org_id, action, payload)
VALUES ($1, $2, 'org_role_revoked', jsonb_build_object(
  'grant_id', $3,
  'target_user_id', $4,
  'role', $5,
  'org_unit_id', $6
))
`, actor, orgID, deleted.ID, deleted.UserID, string(deleted.Role), deleted.OrgUnitID)
		w.WriteHeader(http.StatusNoContent)
	}
}

// GET /api/v1/orgs/{orgId}/users?q=...
func (d Deps) handleOrgUsersSearch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgID, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "orgId")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		if _, ok := d.orgRoleAccess(w, r, orgID, false); !ok {
			return
		}
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeJSON(w, http.StatusOK, map[string]any{"users": []any{}})
			return
		}
		like := "%" + strings.ToLower(q) + "%"
		rows, err := d.Pool.Query(r.Context(), `
SELECT id, email, display_name
FROM "user".users
WHERE org_id = $1
  AND (LOWER(email) LIKE $2 OR LOWER(COALESCE(display_name,'')) LIKE $2)
ORDER BY email ASC
LIMIT 20
`, orgID, like)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list users.")
			return
		}
		defer rows.Close()
		type urow struct {
			ID          string  `json:"id"`
			Email       string  `json:"email"`
			DisplayName *string `json:"displayName"`
		}
		var out []urow
		for rows.Next() {
			var id uuid.UUID
			var email string
			var dn *string
			if err := rows.Scan(&id, &email, &dn); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list users.")
				return
			}
			out = append(out, urow{ID: id.String(), Email: email, DisplayName: dn})
		}
		writeJSON(w, http.StatusOK, map[string]any{"users": out})
	}
}

