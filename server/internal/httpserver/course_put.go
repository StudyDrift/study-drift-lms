package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/relativeschedule"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

// Parity: server `UpdateCourseRequest` (camelCase JSON).
type putCourseBody struct {
	Title               string     `json:"title"`
	Description         string     `json:"description"`
	Published           bool       `json:"published"`
	StartsAt            *time.Time `json:"startsAt"`
	EndsAt              *time.Time `json:"endsAt"`
	VisibleFrom         *time.Time `json:"visibleFrom"`
	HiddenAt            *time.Time `json:"hiddenAt"`
	ScheduleMode        *string    `json:"scheduleMode"`
	RelativeEndAfter    *string    `json:"relativeEndAfter"`
	RelativeHiddenAfter *string    `json:"relativeHiddenAfter"`
}

// handlePutCourse is PUT /api/v1/courses/{course_code} (parity: server `update_handler`).
func (d Deps) handlePutCourse() http.HandlerFunc {
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
		var body putCourseBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		title := strings.TrimSpace(body.Title)
		if title == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Course title is required.")
			return
		}
		existing, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if existing == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		modeStr := existing.ScheduleMode
		if body.ScheduleMode != nil {
			modeStr = strings.TrimSpace(*body.ScheduleMode)
		} else {
			modeStr = strings.TrimSpace(modeStr)
		}
		if modeStr != "fixed" && modeStr != "relative" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid scheduleMode.")
			return
		}
		relEnd, err := relativeschedule.NormalizeRelativeDuration(body.RelativeEndAfter)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		relHide, err := relativeschedule.NormalizeRelativeDuration(body.RelativeHiddenAfter)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		var (
			startsAt, endsAt, visibleFrom, hiddenAt     *time.Time
			relEndAfter, relHiddenAfter                  *string
			relAnchor                                    *time.Time
			outMode                                      string
		)
		if modeStr == "relative" {
			outMode = "relative"
			var anchor time.Time
			if existing.RelativeScheduleAnchorAt != nil {
				anchor = existing.RelativeScheduleAnchorAt.UTC()
			} else if existing.StartsAt != nil {
				anchor = existing.StartsAt.UTC()
			} else {
				anchor = time.Now().UTC()
			}
			relAnchor = &anchor
			relEndAfter, relHiddenAfter = relEnd, relHide
		} else {
			outMode = "fixed"
			startsAt, endsAt, visibleFrom, hiddenAt = body.StartsAt, body.EndsAt, body.VisibleFrom, body.HiddenAt
		}
		desc := strings.TrimSpace(body.Description)
		out, err := course.UpdateCourse(
			r.Context(), d.Pool, courseCode,
			title, desc, body.Published,
			startsAt, endsAt, visibleFrom, hiddenAt,
			outMode, relEndAfter, relHiddenAfter, relAnchor,
		)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update course.")
			return
		}
		if out == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}
