package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	userrepo "github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

type cliUser struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
}

// appRoleToCliRole maps app_roles.name → CLI role string.
func appRoleToCliRole(name string) string {
	switch name {
	case "Teacher":
		return "instructor"
	case "Student":
		return "student"
	case "TA":
		return "ta"
	default:
		return strings.ToLower(name)
	}
}

// cliRoleToAppRole maps CLI role string → app_roles.name.
func cliRoleToAppRole(role string) string {
	switch strings.ToLower(role) {
	case "instructor":
		return "Teacher"
	case "student":
		return "Student"
	case "ta":
		return "TA"
	default:
		return role
	}
}

const platformInboxUUID = "a0000000-0000-4000-8000-000000000001"

// GET /api/v1/users
func (d Deps) handleUsersList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}

		limit := 50
		page := 1
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				limit = n
			}
		}
		if v := r.URL.Query().Get("page"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				page = n
			}
		}
		roleFilter := strings.TrimSpace(r.URL.Query().Get("role"))
		orgFilter := strings.TrimSpace(r.URL.Query().Get("org"))
		offset := (page - 1) * limit

		args := []any{}
		argIdx := 1

		roleJoin := ""
		roleWhere := ""
		if roleFilter != "" {
			dbRole := cliRoleToAppRole(roleFilter)
			roleJoin = `JOIN "user".user_app_roles uar_f ON uar_f.user_id = u.id
JOIN "user".app_roles ar_f ON ar_f.id = uar_f.role_id`
			roleWhere = fmt.Sprintf("AND ar_f.name = $%d", argIdx)
			args = append(args, dbRole)
			argIdx++
		}

		orgWhere := ""
		if orgFilter != "" {
			oid, err := uuid.Parse(orgFilter)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid org UUID.")
				return
			}
			orgWhere = fmt.Sprintf("AND u.org_id = $%d", argIdx)
			args = append(args, oid)
			argIdx++
		}

		args = append(args, limit, offset)
		limitIdx := argIdx
		offsetIdx := argIdx + 1

		q := fmt.Sprintf(`
SELECT u.id::text, u.email, u.display_name,
       (SELECT ar.name FROM "user".user_app_roles uar
        JOIN "user".app_roles ar ON ar.id = uar.role_id
        WHERE uar.user_id = u.id ORDER BY ar.name LIMIT 1) AS role,
       u.created_at
FROM "user".users u
%s
WHERE u.id <> '%s'::uuid
%s %s
ORDER BY u.email ASC
LIMIT $%d OFFSET $%d
`, roleJoin, platformInboxUUID, roleWhere, orgWhere, limitIdx, offsetIdx)

		rows, err := d.Pool.Query(r.Context(), q, args...)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list users.")
			return
		}
		defer rows.Close()

		out := []cliUser{}
		for rows.Next() {
			var u cliUser
			var dn, roleName *string
			if err := rows.Scan(&u.ID, &u.Email, &dn, &roleName, &u.CreatedAt); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list users.")
				return
			}
			if dn != nil {
				u.Name = *dn
			}
			if roleName != nil {
				u.Role = appRoleToCliRole(*roleName)
			}
			out = append(out, u)
		}
		writeJSON(w, http.StatusOK, map[string]any{"users": out})
	}
}

// GET /api/v1/users/{user_id}
func (d Deps) handleUsersGet() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}

		rawID := chi.URLParam(r, "user_id")
		decoded, err := url.PathUnescape(rawID)
		if err != nil {
			decoded = rawID
		}

		const baseSelect = `
SELECT u.id::text, u.email, u.display_name,
       (SELECT ar.name FROM "user".user_app_roles uar
        JOIN "user".app_roles ar ON ar.id = uar.role_id
        WHERE uar.user_id = u.id ORDER BY ar.name LIMIT 1) AS role,
       u.created_at
FROM "user".users u WHERE `

		var q string
		var arg any
		if _, err := uuid.Parse(decoded); err == nil {
			q = baseSelect + "u.id = $1::uuid"
			parsed, _ := uuid.Parse(decoded)
			arg = parsed
		} else {
			q = baseSelect + "LOWER(u.email) = LOWER($1)"
			arg = decoded
		}

		var out cliUser
		var dn, roleName *string
		err = d.Pool.QueryRow(r.Context(), q, arg).Scan(&out.ID, &out.Email, &dn, &roleName, &out.CreatedAt)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "User not found.")
			return
		}
		if dn != nil {
			out.Name = *dn
		}
		if roleName != nil {
			out.Role = appRoleToCliRole(*roleName)
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// POST /api/v1/users
func (d Deps) handleUsersCreate() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}

		var body struct {
			Email string `json:"email"`
			Name  string `json:"name"`
			Role  string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}

		email := userrepo.NormalizeEmail(body.Email)
		if email == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "email is required.")
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "name is required.")
			return
		}

		role := strings.TrimSpace(strings.ToLower(body.Role))
		if role == "" {
			role = "student"
		}
		appRole := cliRoleToAppRole(role)

		ph, err := authservice.PlaceholderPasswordHash()
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to provision user.")
			return
		}

		var id string
		var createdAt time.Time
		err = d.Pool.QueryRow(r.Context(), `
INSERT INTO "user".users (email, password_hash, display_name, org_id)
VALUES ($1, $2, $3, (SELECT id FROM tenant.organizations WHERE slug = 'default' LIMIT 1))
RETURNING id::text, created_at
`, email, ph, name).Scan(&id, &createdAt)
		if err != nil {
			var pe *pgconn.PgError
			if errors.As(err, &pe) && pe.Code == "23505" {
				apierr.WriteJSON(w, http.StatusConflict, apierr.CodeConflict, "A user with that email already exists.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create user.")
			return
		}

		uid, _ := uuid.Parse(id)
		if err := rbac.AssignUserRoleByName(r.Context(), d.Pool, uid, appRole); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to assign role.")
			return
		}

		writeJSON(w, http.StatusCreated, cliUser{
			ID:        id,
			Email:     email,
			Name:      name,
			Role:      role,
			CreatedAt: createdAt,
		})
	}
}
