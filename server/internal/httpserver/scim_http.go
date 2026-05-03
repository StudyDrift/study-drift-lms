package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/provisioning/scim"
)

type scimInstitutionKey struct{}

func scimInstitutionFrom(ctx context.Context) (uuid.UUID, bool) {
	v, ok := ctx.Value(scimInstitutionKey{}).(uuid.UUID)
	return v, ok
}

func (d Deps) scimPublicBaseURL(r *http.Request) string {
	cfg := d.effectiveConfig()
	b := strings.TrimRight(strings.TrimSpace(cfg.LTIAPIBaseURL), "/")
	if b == "" {
		proto := "http"
		if r.TLS != nil {
			proto = "https"
		}
		host := strings.TrimSpace(r.Host)
		if host != "" {
			return proto + "://" + host
		}
		return "http://localhost:8080"
	}
	return b
}

func (d Deps) scimBearerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !d.effectiveConfig().ScimEnabled {
			http.NotFound(w, r)
			return
		}
		if d.Pool == nil {
			http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
			return
		}
		raw, ok := auth.BearerToken(r.Header)
		if !ok {
			writeSCIMError(w, http.StatusUnauthorized, "invalidCredentials", "Unauthorized")
			return
		}
		inst, err := scim.ResolveInstitutionFromBearer(r.Context(), d.Pool, raw)
		if err != nil {
			writeSCIMError(w, http.StatusUnauthorized, "invalidCredentials", "Unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), scimInstitutionKey{}, inst)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func writeSCIMError(w http.ResponseWriter, status int, scimType, detail string) {
	w.Header().Set("Content-Type", "application/scim+json")
	w.WriteHeader(status)
	body := map[string]any{
		"schemas": []string{"urn:ietf:params:scim:api:messages:2.0:Error"},
		"status":  status,
		"detail":  detail,
	}
	if strings.TrimSpace(scimType) != "" {
		body["scimType"] = scimType
	}
	_ = json.NewEncoder(w).Encode(body)
}

func (d Deps) handleSCIMServiceProviderConfig() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeSCIMError(w, http.StatusMethodNotAllowed, "invalidSyntax", "Method not allowed")
			return
		}
		w.Header().Set("Content-Type", "application/scim+json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"schemas": []string{"urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"},
			"patch":   map[string]bool{"supported": true},
			"filter":  map[string]bool{"supported": true},
			"changePassword": map[string]bool{"supported": false},
			"sort":           map[string]bool{"supported": false},
			"etag":           map[string]bool{"supported": false},
			"authenticationSchemes": []map[string]any{
				{"type": "oauthbearertoken", "name": "OAuth Bearer Token", "description": "SCIM bearer token", "specUri": "https://tools.ietf.org/html/rfc6750", "documentationUri": ""},
			},
		})
	}
}

func (d Deps) handleSCIMSchemas() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeSCIMError(w, http.StatusMethodNotAllowed, "invalidSyntax", "Method not allowed")
			return
		}
		w.Header().Set("Content-Type", "application/scim+json")
		userSchema := map[string]any{
			"id":          "urn:ietf:params:scim:schemas:core:2.0:User",
			"name":        "User",
			"description": "User resource",
			"attributes": []map[string]any{
				{"name": "userName", "type": "string", "multiValued": false, "required": true},
				{"name": "displayName", "type": "string", "multiValued": false, "required": false},
				{"name": "active", "type": "boolean", "multiValued": false, "required": false},
				{"name": "externalId", "type": "string", "multiValued": false, "required": false},
			},
		}
		groupSchema := map[string]any{
			"id":          "urn:ietf:params:scim:schemas:core:2.0:Group",
			"name":        "Group",
			"description": "Group resource",
			"attributes": []map[string]any{
				{"name": "displayName", "type": "string", "multiValued": false, "required": false},
			},
		}
		_ = json.NewEncoder(w).Encode([]any{userSchema, groupSchema})
	}
}

func (d Deps) handleSCIMUsersCollection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inst, ok := scimInstitutionFrom(r.Context())
		if !ok {
			writeSCIMError(w, http.StatusUnauthorized, "invalidCredentials", "Unauthorized")
			return
		}
		base := d.scimPublicBaseURL(r)
		switch r.Method {
		case http.MethodGet:
			filter := strings.TrimSpace(r.URL.Query().Get("filter"))
			list, err := scim.ListUsers(r.Context(), d.Pool, inst, filter, base)
			if err != nil {
				writeSCIMError(w, http.StatusInternalServerError, "invalidSyntax", "Failed to list users")
				return
			}
			w.Header().Set("Content-Type", "application/scim+json")
			_ = json.NewEncoder(w).Encode(list)
		case http.MethodPost:
			b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			if err != nil {
				writeSCIMError(w, http.StatusBadRequest, "invalidSyntax", "Invalid body")
				return
			}
			var u scim.UserResource
			if err := json.Unmarshal(b, &u); err != nil {
				writeSCIMError(w, http.StatusBadRequest, "invalidSyntax", "Invalid JSON")
				return
			}
			out, err := scim.CreateUser(r.Context(), d.Pool, inst, &u, base)
			if errors.Is(err, scim.ErrUniqueness) {
				writeSCIMError(w, http.StatusConflict, "uniqueness", "Resource already exists")
				return
			}
			if errors.Is(err, scim.ErrInvalidValue) {
				writeSCIMError(w, http.StatusBadRequest, "invalidValue", "Invalid attribute value")
				return
			}
			if err != nil {
				writeSCIMError(w, http.StatusInternalServerError, "invalidSyntax", "Create failed")
				return
			}
			w.Header().Set("Content-Type", "application/scim+json")
			w.Header().Set("Location", base+"/scim/v2/Users/"+out.ID)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(out)
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
			writeSCIMError(w, http.StatusMethodNotAllowed, "invalidSyntax", "Method not allowed")
		}
	}
}

func (d Deps) handleSCIMUserOne() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inst, ok := scimInstitutionFrom(r.Context())
		if !ok {
			writeSCIMError(w, http.StatusUnauthorized, "invalidCredentials", "Unauthorized")
			return
		}
		id := strings.TrimSpace(chi.URLParam(r, "id"))
		base := d.scimPublicBaseURL(r)
		switch r.Method {
		case http.MethodGet:
			u, err := scim.GetUser(r.Context(), d.Pool, inst, id, base)
			if errors.Is(err, scim.ErrNotFound) {
				writeSCIMError(w, http.StatusNotFound, "", "Resource not found")
				return
			}
			if err != nil {
				writeSCIMError(w, http.StatusInternalServerError, "invalidSyntax", "Lookup failed")
				return
			}
			w.Header().Set("Content-Type", "application/scim+json")
			_ = json.NewEncoder(w).Encode(u)
		case http.MethodPut:
			b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			if err != nil {
				writeSCIMError(w, http.StatusBadRequest, "invalidSyntax", "Invalid body")
				return
			}
			var body scim.UserResource
			if err := json.Unmarshal(b, &body); err != nil {
				writeSCIMError(w, http.StatusBadRequest, "invalidSyntax", "Invalid JSON")
				return
			}
			out, err := scim.ReplaceUser(r.Context(), d.Pool, inst, id, &body, base)
			if errors.Is(err, scim.ErrNotFound) {
				writeSCIMError(w, http.StatusNotFound, "", "Resource not found")
				return
			}
			if errors.Is(err, scim.ErrUniqueness) {
				writeSCIMError(w, http.StatusConflict, "uniqueness", "Uniqueness violation")
				return
			}
			if errors.Is(err, scim.ErrInvalidValue) {
				writeSCIMError(w, http.StatusBadRequest, "invalidValue", "Invalid attribute value")
				return
			}
			if err != nil {
				writeSCIMError(w, http.StatusInternalServerError, "invalidSyntax", "Update failed")
				return
			}
			w.Header().Set("Content-Type", "application/scim+json")
			_ = json.NewEncoder(w).Encode(out)
		case http.MethodPatch:
			b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			if err != nil {
				writeSCIMError(w, http.StatusBadRequest, "invalidSyntax", "Invalid body")
				return
			}
			out, err := scim.PatchUser(r.Context(), d.Pool, inst, id, b, base)
			if errors.Is(err, scim.ErrNotFound) {
				writeSCIMError(w, http.StatusNotFound, "", "Resource not found")
				return
			}
			if errors.Is(err, scim.ErrInvalidValue) {
				writeSCIMError(w, http.StatusBadRequest, "invalidValue", "Invalid patch")
				return
			}
			if err != nil {
				writeSCIMError(w, http.StatusInternalServerError, "invalidSyntax", "Patch failed")
				return
			}
			w.Header().Set("Content-Type", "application/scim+json")
			_ = json.NewEncoder(w).Encode(out)
		case http.MethodDelete:
			err := scim.DeleteUser(r.Context(), d.Pool, inst, id)
			if errors.Is(err, scim.ErrNotFound) {
				writeSCIMError(w, http.StatusNotFound, "", "Resource not found")
				return
			}
			if err != nil {
				writeSCIMError(w, http.StatusInternalServerError, "invalidSyntax", "Delete failed")
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete}, ", "))
			writeSCIMError(w, http.StatusMethodNotAllowed, "invalidSyntax", "Method not allowed")
		}
	}
}

func (d Deps) handleSCIMGroupsCollection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		base := d.scimPublicBaseURL(r)
		switch r.Method {
		case http.MethodGet:
			scim.WriteGroupList(w)
		case http.MethodPost:
			_, _ = io.ReadAll(io.LimitReader(r.Body, 1<<20))
			id := uuid.NewString()
			scim.WriteGroupCreated(w, base, id)
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
			writeSCIMError(w, http.StatusMethodNotAllowed, "invalidSyntax", "Method not allowed")
		}
	}
}

func (d Deps) handleSCIMGroupPatch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			writeSCIMError(w, http.StatusMethodNotAllowed, "invalidSyntax", "Method not allowed")
			return
		}
		writeSCIMError(w, http.StatusNotImplemented, "invalidSyntax", "Group PATCH not implemented")
	}
}
