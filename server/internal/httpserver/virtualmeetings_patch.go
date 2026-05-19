package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/virtualmeetings"
)

type patchMeetingBody struct {
	Title          *string `json:"title"`
	ScheduledStart *string `json:"scheduledStart"`
	ScheduledEnd   *string `json:"scheduledEnd"`
	JoinURL        *string `json:"joinUrl"`
	HostURL        *string `json:"hostUrl"`
	Status         *string `json:"status"`
}

// handlePatchMeeting is PATCH /api/v1/meetings/{meeting_id}.
func (d Deps) handlePatchMeeting() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		midStr := chi.URLParam(r, "meeting_id")
		mid, err := uuid.Parse(midStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid meeting ID.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		m, err := virtualmeetings.GetByID(ctx, d.Pool, mid)
		if err != nil || m == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Meeting not found.")
			return
		}

		courseID, err := uuid.Parse(m.CourseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		isStaff, err := enrollment.UserIsCourseStaffByID(ctx, d.Pool, courseID, userID)
		if err != nil || !isStaff {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only instructors can update meetings.")
			return
		}

		var body patchMeetingBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}

		title := m.Title
		if body.Title != nil {
			title = strings.TrimSpace(*body.Title)
			if title == "" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title cannot be empty.")
				return
			}
		}

		scheduledStart := m.ScheduledStart
		if body.ScheduledStart != nil {
			if *body.ScheduledStart == "" {
				scheduledStart = nil
			} else {
				t, err := time.Parse(time.RFC3339, *body.ScheduledStart)
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "scheduledStart must be RFC3339.")
					return
				}
				scheduledStart = &t
			}
		}

		scheduledEnd := m.ScheduledEnd
		if body.ScheduledEnd != nil {
			if *body.ScheduledEnd == "" {
				scheduledEnd = nil
			} else {
				t, err := time.Parse(time.RFC3339, *body.ScheduledEnd)
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "scheduledEnd must be RFC3339.")
					return
				}
				scheduledEnd = &t
			}
		}

		status := m.Status
		if body.Status != nil {
			s := strings.ToLower(*body.Status)
			validStatuses := map[string]bool{"scheduled": true, "live": true, "ended": true, "cancelled": true}
			if !validStatuses[s] {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid status.")
				return
			}
			status = s
		}

		joinURL := m.JoinURL
		if body.JoinURL != nil {
			joinURL = body.JoinURL
		}
		hostURL := m.HostURL
		if body.HostURL != nil {
			hostURL = body.HostURL
		}

		updated, err := virtualmeetings.Update(ctx, d.Pool, mid, title, scheduledStart, scheduledEnd, joinURL, hostURL, status)
		if err != nil || updated == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update meeting.")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(updated)
	}
}
