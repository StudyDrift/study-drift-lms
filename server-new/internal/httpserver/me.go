package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/auth"
	"github.com/lextures/lextures/server-new/internal/repos/oidc"
	"github.com/lextures/lextures/server-new/internal/service/meperm"
)

type myPermissionsResponse struct {
	PermissionStrings []string `json:"permissionStrings"`
}

// meUserID returns the authenticated user id or writes 401/500 and returns false.
func (d Deps) meUserID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	if d.JWTSigner == nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	u, err := auth.UserFromRequest(r, d.JWTSigner)
	if err != nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	userID, err := uuid.Parse(u.UserID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	if d.Pool == nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
		return uuid.UUID{}, false
	}
	return userID, true
}

func (d Deps) handleMyPermissions() http.HandlerFunc {
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
		q := r.URL.Query()
		perms, err := meperm.MyPermissions(
			r.Context(), d.Pool, userID, q.Get("courseCode"), q.Get("viewAs"),
		)
		if err != nil {
			st, code, msg := meperm.HTTPErrorFor(err)
			apierr.WriteJSON(w, st, code, msg)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(myPermissionsResponse{PermissionStrings: perms})
	}
}

type oidcIdentityItem struct {
	ID       string  `json:"id"`
	Provider string  `json:"provider"`
	Email    *string `json:"email"`
}

type oidcIdentitiesResponse struct {
	Identities []oidcIdentityItem `json:"identities"`
}

func (d Deps) handleMyOIDCIdentities() http.HandlerFunc {
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
		rows, err := oidc.ListByUserID(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load identities.")
			return
		}
		items := make([]oidcIdentityItem, 0, len(rows))
		for _, row := range rows {
			items = append(items, oidcIdentityItem{
				ID:       row.ID.String(),
				Provider: row.Provider,
				Email:    row.Email,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(oidcIdentitiesResponse{Identities: items})
	}
}

func (d Deps) handleDeleteMyOIDCIdentity() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		rawID := chi.URLParam(r, "id")
		identID, err := uuid.Parse(rawID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid identity id.")
			return
		}
		deleted, err := oidc.DeleteByIDForUser(r.Context(), d.Pool, userID, identID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not remove identity.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Identity not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}
