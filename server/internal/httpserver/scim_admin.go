package httpserver

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/provisioning/scim"
)

func randomSCIMToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

type postScimTokenBody struct {
	InstitutionID string `json:"institutionId"`
	Label         string `json:"label"`
}

// handleAdminScimTokenPost is POST /api/v1/admin/provisioning/scim/tokens
func (d Deps) handleAdminScimTokenPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().ScimEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "SCIM is not enabled.")
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		var body postScimTokenBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		instID, err := uuid.Parse(strings.TrimSpace(body.InstitutionID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "institutionId must be a UUID.")
			return
		}
		tok, err := randomSCIMToken()
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not generate token.")
			return
		}
		id, err := scim.InsertBearerToken(r.Context(), d.Pool, instID, strings.TrimSpace(body.Label), tok)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not store token.")
			return
		}
		base := strings.TrimRight(strings.TrimSpace(d.effectiveConfig().LTIAPIBaseURL), "/")
		if base == "" {
			base = "http://localhost:8080"
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"id":              id.String(),
			"institutionId":   instID.String(),
			"token":           tok,
			"scimEndpointUrl": base + "/scim/v2",
		})
	}
}

// handleAdminScimTokenDelete is DELETE /api/v1/admin/provisioning/scim/tokens/{id}
func (d Deps) handleAdminScimTokenDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().ScimEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "SCIM is not enabled.")
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		raw := chi.URLParam(r, "id")
		tid, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid token id.")
			return
		}
		ok, err := scim.RevokeBearerToken(r.Context(), d.Pool, tid, nil)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not revoke token.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Token not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

type scimTokenRow struct {
	ID            uuid.UUID  `json:"id"`
	InstitutionID uuid.UUID  `json:"institutionId"`
	Label         string     `json:"label"`
	CreatedAt     time.Time  `json:"createdAt"`
	RevokedAt     *time.Time `json:"revokedAt,omitempty"`
}

// handleAdminScimTokensList is GET /api/v1/admin/provisioning/scim/tokens?institutionId=
func (d Deps) handleAdminScimTokensList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().ScimEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "SCIM is not enabled.")
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		instStr := strings.TrimSpace(r.URL.Query().Get("institutionId"))
		instID, err := uuid.Parse(instStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "institutionId query param required (UUID).")
			return
		}
		rows, err := d.Pool.Query(r.Context(), `
SELECT id, institution_id, label, created_at, revoked_at
FROM settings.scim_bearer_tokens
WHERE institution_id = $1
ORDER BY created_at DESC
LIMIT 50
`, instID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list tokens.")
			return
		}
		defer rows.Close()
		var out []scimTokenRow
		for rows.Next() {
			var tr scimTokenRow
			var revoked sql.NullTime
			if err := rows.Scan(&tr.ID, &tr.InstitutionID, &tr.Label, &tr.CreatedAt, &revoked); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list tokens.")
				return
			}
			if revoked.Valid {
				t := revoked.Time
				tr.RevokedAt = &t
			}
			out = append(out, tr)
		}
		if err := rows.Err(); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list tokens.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"tokens": out})
	}
}

type scimEventRow struct {
	ID           string    `json:"id"`
	Operation    string    `json:"operation"`
	ScimResource string    `json:"scimResource"`
	UserEmail    *string   `json:"userEmail"`
	CreatedAt    time.Time `json:"createdAt"`
}

// handleAdminScimEventsList is GET /api/v1/admin/provisioning/scim/events
func (d Deps) handleAdminScimEventsList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().ScimEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "SCIM is not enabled.")
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		instStr := strings.TrimSpace(r.URL.Query().Get("institutionId"))
		instID, err := uuid.Parse(instStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "institutionId query param required (UUID).")
			return
		}
		rows, err := d.Pool.Query(r.Context(), `
SELECT e.id::text, e.operation, e.scim_resource, u.email, e.created_at
FROM provisioning.scim_provisioning_events e
LEFT JOIN "user".users u ON u.id = e.affected_user_id
WHERE e.institution_id = $1
ORDER BY e.created_at DESC
LIMIT 200
`, instID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load events.")
			return
		}
		defer rows.Close()
		var out []scimEventRow
		for rows.Next() {
			var er scimEventRow
			var email *string
			if err := rows.Scan(&er.ID, &er.Operation, &er.ScimResource, &email, &er.CreatedAt); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load events.")
				return
			}
			er.UserEmail = email
			out = append(out, er)
		}
		if err := rows.Err(); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load events.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"events": out})
	}
}
