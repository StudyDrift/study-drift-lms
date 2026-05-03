package httpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/organization"
)

type orgPublicResponse struct {
	ID          string          `json:"id"`
	Slug        string          `json:"slug"`
	Name        string          `json:"name"`
	Status      string          `json:"status"`
	MaxUsers    *int32          `json:"maxUsers"`
	MaxCourses  *int32          `json:"maxCourses"`
	DataRegion  string          `json:"dataRegion"`
	Metadata    json.RawMessage `json:"metadata"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
	UserCount   int64           `json:"userCount"`
	CourseCount int64           `json:"courseCount"`
}

func orgRowToPublic(r organization.Row) orgPublicResponse {
	meta := r.Metadata
	if len(meta) == 0 {
		meta = []byte("{}")
	}
	return orgPublicResponse{
		ID:          r.ID.String(),
		Slug:        r.Slug,
		Name:        r.Name,
		Status:      r.Status,
		MaxUsers:    r.MaxUsers,
		MaxCourses:  r.MaxCourses,
		DataRegion:  r.DataRegion,
		Metadata:    meta,
		CreatedAt:   r.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt:   r.UpdatedAt.UTC().Format(time.RFC3339Nano),
		UserCount:   r.UserCount,
		CourseCount: r.CourseCount,
	}
}

type postOrgBody struct {
	Name        string          `json:"name"`
	Slug        string          `json:"slug"`
	MaxUsers    *int32          `json:"maxUsers"`
	MaxCourses  *int32          `json:"maxCourses"`
	DataRegion  *string         `json:"dataRegion"`
	Metadata    json.RawMessage `json:"metadata"`
}

type patchOrgBody struct {
	Name        *string         `json:"name"`
	Status      *string         `json:"status"`
	MaxUsers    *int32          `json:"maxUsers"`
	MaxCourses  *int32          `json:"maxCourses"`
	DataRegion  *string         `json:"dataRegion"`
	Metadata    *json.RawMessage `json:"metadata"`
}

func (d Deps) handleAdminOrgsCollection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actorID, ok := d.adminRbacUser(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			limit := int32(100)
			offset := int32(0)
			if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
				if n, err := strconv.ParseInt(v, 10, 32); err == nil && n > 0 {
					limit = int32(n)
				}
			}
			if v := strings.TrimSpace(r.URL.Query().Get("offset")); v != "" {
				if n, err := strconv.ParseInt(v, 10, 32); err == nil && n >= 0 {
					offset = int32(n)
				}
			}
			rows, err := organization.List(ctx, d.Pool, limit, offset)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list organizations.")
				return
			}
			out := make([]orgPublicResponse, 0, len(rows))
			for _, row := range rows {
				out = append(out, orgRowToPublic(row))
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{"organizations": out})
		case http.MethodPost:
			var body postOrgBody
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			name := strings.TrimSpace(body.Name)
			slug := strings.TrimSpace(body.Slug)
			if slug == "" {
				slug = strings.ToLower(strings.ReplaceAll(name, " ", "-"))
			}
			var dr *string
			if body.DataRegion != nil && strings.TrimSpace(*body.DataRegion) != "" {
				s := strings.TrimSpace(*body.DataRegion)
				dr = &s
			}
			meta := body.Metadata
			row, err := organization.Create(ctx, d.Pool, name, slug, body.MaxUsers, body.MaxCourses, derefStr(dr), meta)
			if err != nil {
				if strings.Contains(err.Error(), "slug already") {
					apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, "That slug is already in use.")
					return
				}
				if strings.Contains(err.Error(), "required") {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create organization.")
				return
			}
			_ = organization.InsertAudit(ctx, d.Pool, actorID, row.ID, "org_created", map[string]any{"slug": row.Slug, "name": row.Name})
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(orgRowToPublic(row))
		default:
			w.Header().Set("Allow", "GET, POST")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

func (d Deps) handleAdminOrgItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actorID, ok := d.adminRbacUser(w, r)
		if !ok {
			return
		}
		idStr := strings.TrimSpace(chi.URLParam(r, "id"))
		id, err := uuid.Parse(idStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			row, err := organization.GetByID(ctx, d.Pool, id)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load organization.")
				return
			}
			if row == nil {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(orgRowToPublic(*row))
		case http.MethodPatch:
			b, _ := io.ReadAll(r.Body)
			_ = r.Body.Close()
			var body patchOrgBody
			if len(b) > 0 {
				if err := json.Unmarshal(b, &body); err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
					return
				}
			}
			row, err := organization.Patch(ctx, d.Pool, id, body.Name, body.Status, body.MaxUsers, body.MaxCourses, body.DataRegion, body.Metadata)
			if err != nil {
				if strings.Contains(err.Error(), "invalid status") {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update organization.")
				return
			}
			if row == nil {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
			_ = organization.InsertAudit(ctx, d.Pool, actorID, id, "org_updated", map[string]any{"status": row.Status})
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(orgRowToPublic(*row))
		case http.MethodDelete:
			row, err := organization.Patch(ctx, d.Pool, id, nil, ptrStr("deleted"), nil, nil, nil, nil)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete organization.")
				return
			}
			if row == nil {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
			_ = organization.InsertAudit(ctx, d.Pool, actorID, id, "org_deleted", map[string]any{})
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(orgRowToPublic(*row))
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPatch, http.MethodDelete}, ", "))
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func ptrStr(s string) *string { return &s }
