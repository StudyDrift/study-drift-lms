package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/standards"
)

func (d Deps) handleListStandards() http.HandlerFunc {
	type codeOut struct {
		ID          string  `json:"id"`
		FrameworkID string  `json:"frameworkId"`
		Code        string  `json:"code"`
		ShortCode   *string `json:"shortCode,omitempty"`
		Description string  `json:"description"`
		GradeBand   *string `json:"gradeBand,omitempty"`
		DepthLevel  int16   `json:"depthLevel"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		fw := strings.TrimSpace(r.URL.Query().Get("framework"))
		if fw == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "framework is required.")
			return
		}
		grade := strings.TrimSpace(r.URL.Query().Get("grade"))
		var gradePtr *string
		if grade != "" {
			gradePtr = &grade
		}
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		lim := int64(200)
		if s := r.URL.Query().Get("limit"); s != "" {
			if n, err := strconv.ParseInt(s, 10, 64); err == nil {
				lim = min64(max64(n, 1), 500)
			}
		}
		meta, err := standards.GetLatestFrameworkByCode(r.Context(), d.Pool, fw)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load framework.")
			return
		}
		if meta == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Framework not found.")
			return
		}
		var rows []standards.StandardCodeRow
		if q != "" {
			rows, err = standards.SearchStandardCodes(r.Context(), d.Pool, meta.ID, gradePtr, q, lim)
		} else {
			rows, err = standards.ListStandardCodes(r.Context(), d.Pool, meta.ID, gradePtr, lim)
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list standards.")
			return
		}
		out := make([]codeOut, 0, len(rows))
		for _, row := range rows {
			out = append(out, codeOut{
				ID:          row.ID.String(),
				FrameworkID: row.FrameworkID.String(),
				Code:        row.Code,
				ShortCode:   row.ShortCode,
				Description: row.Description,
				GradeBand:   row.GradeBand,
				DepthLevel:  row.DepthLevel,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (d Deps) handleSearchStandards() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		fw := strings.TrimSpace(r.URL.Query().Get("framework"))
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if fw == "" || q == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "framework and q are required.")
			return
		}
		lim := int64(100)
		meta, err := standards.GetLatestFrameworkByCode(r.Context(), d.Pool, fw)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load framework.")
			return
		}
		if meta == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Framework not found.")
			return
		}
		rows, err := standards.SearchStandardCodes(r.Context(), d.Pool, meta.ID, nil, q, lim)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Search failed.")
			return
		}
		// Reuse list output shape
		type codeOut struct {
			ID          string  `json:"id"`
			FrameworkID string  `json:"frameworkId"`
			Code        string  `json:"code"`
			ShortCode   *string `json:"shortCode,omitempty"`
			Description string  `json:"description"`
		}
		out := make([]codeOut, 0, len(rows))
		for _, row := range rows {
			out = append(out, codeOut{
				ID:          row.ID.String(),
				FrameworkID: row.FrameworkID.String(),
				Code:        row.Code,
				ShortCode:   row.ShortCode,
				Description: row.Description,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (d Deps) handleGetStandard() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		row, err := standards.GetStandardCodeByID(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load standard.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		fw, err := standards.GetFrameworkByID(r.Context(), d.Pool, row.FrameworkID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load framework.")
			return
		}
		if fw == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		type out struct {
			ID                         string  `json:"id"`
			FrameworkID                string  `json:"frameworkId"`
			Code                       string  `json:"code"`
			ShortCode                  *string `json:"shortCode,omitempty"`
			Description                string  `json:"description"`
			GradeBand                  *string `json:"gradeBand,omitempty"`
			FrameworkCode              string  `json:"frameworkCode"`
			FrameworkName              string  `json:"frameworkName"`
			FrameworkVersion           string  `json:"frameworkVersion"`
			DepthLevel                 int16   `json:"depthLevel"`
			SupersededByStandardCodeID *string `json:"supersededByStandardCodeId,omitempty"`
		}
		var sup *string
		if row.SupersededByStandardCodeID != nil {
			s := row.SupersededByStandardCodeID.String()
			sup = &s
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out{
			ID:                         row.ID.String(),
			FrameworkID:                row.FrameworkID.String(),
			Code:                       row.Code,
			ShortCode:                  row.ShortCode,
			Description:                row.Description,
			GradeBand:                  row.GradeBand,
			FrameworkCode:              fw.Code,
			FrameworkName:              fw.Name,
			FrameworkVersion:           fw.Version,
			DepthLevel:                 row.DepthLevel,
			SupersededByStandardCodeID: sup,
		})
	}
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func (d Deps) registerStandardsRoutes(r chi.Router) {
	r.Get("/api/v1/standards/search", d.handleSearchStandards())
	r.Get("/api/v1/standards/{id}", d.handleGetStandard())
	r.Get("/api/v1/standards", d.handleListStandards())
}
