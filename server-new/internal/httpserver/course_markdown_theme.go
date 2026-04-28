package httpserver

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/course"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
)

// Parity: server/src/models/course.rs MARKDOWN_THEME_PRESETS
var markdownThemePresets = []string{
	"classic", "reader", "serif", "contrast", "night", "accent", "custom",
}

type updateMarkdownThemeBody struct {
	Preset string                     `json:"preset"`
	Custom *markdownThemeCustomFields `json:"custom"`
}

// Matches Rust `MarkdownThemeCustom` (camelCase); used when preset is "custom".
type markdownThemeCustomFields struct {
	HeadingColor     *string `json:"headingColor"`
	BodyColor        *string `json:"bodyColor"`
	LinkColor        *string `json:"linkColor"`
	CodeBackground   *string `json:"codeBackground"`
	BlockquoteBorder *string `json:"blockquoteBorder"`
	ArticleWidth     *string `json:"articleWidth"`
	FontFamily       *string `json:"fontFamily"`
}

// handlePatchCourseMarkdownTheme is PATCH /api/v1/courses/{course_code}/markdown-theme
func (d Deps) handlePatchCourseMarkdownTheme() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode := chi.URLParam(r, "course_code")
		if courseCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		hasAccess, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !hasAccess {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, userID, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		var body updateMarkdownThemeBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		preset := strings.TrimSpace(body.Preset)
		if preset == "" || !slices.Contains(markdownThemePresets, preset) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Unknown markdown theme preset.")
			return
		}
		var customBytes []byte
		if preset == "custom" {
			if body.Custom == nil {
				customBytes = append([]byte(nil), course.DefaultMarkdownThemeCustomJSON...)
			} else {
				b, err := json.Marshal(body.Custom)
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid custom theme payload.")
					return
				}
				customBytes = b
			}
		}
		updated, err := course.UpdateMarkdownTheme(r.Context(), d.Pool, courseCode, preset, customBytes)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update course.")
			return
		}
		if updated == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(updated)
	}
}
