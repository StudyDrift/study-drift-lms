package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/lextures/lextures/server-new/internal/apierr"
	ltidb "github.com/lextures/lextures/server-new/internal/repos/lti"
)

// handleAdminListLTIRegistrations is GET /api/v1/admin/lti/registrations
func (d Deps) handleAdminListLTIRegistrations() http.HandlerFunc {
	type response struct {
		ParentPlatforms []ltidb.ParentPlatform `json:"parentPlatforms"`
		ExternalTools   []ltidb.ExternalTool   `json:"externalTools"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		parents, tools, err := ltidb.ListAdminRegistrations(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load LTI registrations.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(response{ParentPlatforms: parents, ExternalTools: tools})
	}
}

// handleAdminPostExternalTool is POST /api/v1/admin/lti/external-tools
func (d Deps) handleAdminPostExternalTool() http.HandlerFunc {
	type body struct {
		Name            string  `json:"name"`
		ClientID        string  `json:"clientId"`
		ToolIssuer      string  `json:"toolIssuer"`
		ToolJWKSURL     string  `json:"toolJwksUrl"`
		ToolOidcAuthURL string  `json:"toolOidcAuthUrl"`
		ToolTokenURL    *string `json:"toolTokenUrl"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var in body
		if err := json.Unmarshal(b, &in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		in.ClientID = strings.TrimSpace(in.ClientID)
		in.ToolIssuer = strings.TrimSpace(in.ToolIssuer)
		in.ToolJWKSURL = strings.TrimSpace(in.ToolJWKSURL)
		in.ToolOidcAuthURL = strings.TrimSpace(in.ToolOidcAuthURL)
		if in.Name == "" || in.ClientID == "" || in.ToolIssuer == "" || in.ToolJWKSURL == "" || in.ToolOidcAuthURL == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing required fields.")
			return
		}
		if in.ToolTokenURL != nil {
			t := strings.TrimSpace(*in.ToolTokenURL)
			if t == "" {
				in.ToolTokenURL = nil
			} else {
				in.ToolTokenURL = &t
			}
		}
		out, err := ltidb.CreateExternalTool(
			r.Context(), d.Pool, in.Name, in.ClientID, in.ToolIssuer, in.ToolJWKSURL, in.ToolOidcAuthURL, in.ToolTokenURL)
		if err != nil {
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg != nil && pg.Code == "23505" {
				apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, "A tool with this issuer and client id already exists.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create external tool.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(out)
	}
}

type postParentRegBody struct {
	Name              string   `json:"name"`
	ClientID          string   `json:"clientId"`
	PlatformISS       string   `json:"platformIss"`
	PlatformJWKSURL   string   `json:"platformJwksUrl"`
	PlatformAuthURL   string   `json:"platformAuthUrl"`
	PlatformTokenURL  string   `json:"platformTokenUrl"`
	ToolRedirectURIs  []string `json:"toolRedirectUris"`
	DeploymentIDs     []string `json:"deploymentIds"`
}

// handleAdminPostLtiParentRegistration is POST /api/v1/admin/lti/registrations
func (d Deps) handleAdminPostLtiParentRegistration() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var in postParentRegBody
		if err := json.Unmarshal(b, &in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		in.ClientID = strings.TrimSpace(in.ClientID)
		in.PlatformISS = strings.TrimSpace(in.PlatformISS)
		in.PlatformJWKSURL = strings.TrimSpace(in.PlatformJWKSURL)
		in.PlatformAuthURL = strings.TrimSpace(in.PlatformAuthURL)
		in.PlatformTokenURL = strings.TrimSpace(in.PlatformTokenURL)
		if in.Name == "" || in.ClientID == "" || in.PlatformISS == "" || in.PlatformJWKSURL == "" || in.PlatformAuthURL == "" || in.PlatformTokenURL == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing required fields.")
			return
		}
		id, err := ltidb.InsertPlatformRegistration(r.Context(), d.Pool, in.Name, in.ClientID, in.PlatformISS,
			in.PlatformJWKSURL, in.PlatformAuthURL, in.PlatformTokenURL, in.ToolRedirectURIs, in.DeploymentIDs)
		if err != nil {
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg != nil && pg.Code == "23505" {
				apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, "A registration with this issuer and client id already exists.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create registration.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id.String()})
	}
}

type putActiveBody struct {
	Active bool `json:"active"`
}

// handleAdminPutLtiParentRegistration is PUT /api/v1/admin/lti/registrations/{id}
func (d Deps) handleAdminPutLtiParentRegistration() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut+","+http.MethodOptions)
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
		var body putActiveBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		ok, err := ltidb.UpdatePlatformRegistrationActive(r.Context(), d.Pool, id, body.Active)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update registration.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleAdminDeleteLtiParentRegistration is DELETE /api/v1/admin/lti/registrations/{id}
func (d Deps) handleAdminDeleteLtiParentRegistration() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete+","+http.MethodOptions)
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
		ok, err := ltidb.DeletePlatformRegistration(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete registration.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleAdminPutLtiExternalTool is PUT /api/v1/admin/lti/external-tools/{id}
func (d Deps) handleAdminPutLtiExternalTool() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut+","+http.MethodOptions)
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
		var body putActiveBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		ok, err := ltidb.UpdateExternalToolActive(r.Context(), d.Pool, id, body.Active)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update tool.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleAdminDeleteLtiExternalTool is DELETE /api/v1/admin/lti/external-tools/{id}
func (d Deps) handleAdminDeleteLtiExternalTool() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete+","+http.MethodOptions)
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
		ok, err := ltidb.DeleteExternalTool(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete tool.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
