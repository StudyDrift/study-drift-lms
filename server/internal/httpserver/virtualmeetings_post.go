package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/virtualmeetings"
	"github.com/lextures/lextures/server/internal/service/video"
)

type createMeetingBody struct {
	Provider       string  `json:"provider"`
	Title          string  `json:"title"`
	ScheduledStart *string `json:"scheduledStart"`
	ScheduledEnd   *string `json:"scheduledEnd"`
	SectionID      *string `json:"sectionId"`
}

// handleCreateMeeting is POST /api/v1/courses/{course_code}/meetings.
func (d Deps) handleCreateMeeting() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
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
		ctx := r.Context()

		isStaff, err := enrollment.UserIsCourseStaff(ctx, d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !isStaff {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only instructors can create meetings.")
			return
		}

		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		var body createMeetingBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}

		title := strings.TrimSpace(body.Title)
		if title == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Meeting title is required.")
			return
		}
		provider := strings.ToLower(strings.TrimSpace(body.Provider))
		if provider == "" {
			provider = "jitsi"
		}
		validProviders := map[string]bool{"jitsi": true, "bbb": true, "zoom": true, "meet": true, "lti": true, "custom": true}
		if !validProviders[provider] {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid provider.")
			return
		}

		var scheduledStart, scheduledEnd *time.Time
		if body.ScheduledStart != nil && *body.ScheduledStart != "" {
			t, err := time.Parse(time.RFC3339, *body.ScheduledStart)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "scheduledStart must be RFC3339.")
				return
			}
			scheduledStart = &t
		}
		if body.ScheduledEnd != nil && *body.ScheduledEnd != "" {
			t, err := time.Parse(time.RFC3339, *body.ScheduledEnd)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "scheduledEnd must be RFC3339.")
				return
			}
			scheduledEnd = &t
		}

		var sectionID *uuid.UUID
		if body.SectionID != nil && *body.SectionID != "" {
			sid, err := uuid.Parse(*body.SectionID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid sectionId.")
				return
			}
			sectionID = &sid
		}

		meetingUUID := uuid.New()
		var joinURL, hostURL *string

		// Generate join URLs for providers that don't need an external API call.
		meetingParams := video.MeetingParams{
			MeetingID:      meetingUUID,
			CourseCode:     courseCode,
			Title:          title,
			ScheduledStart: scheduledStart,
		}
		switch provider {
		case "jitsi":
			urls, err := d.jitsiProvider().CreateMeeting(ctx, meetingParams)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create Jitsi room.")
				return
			}
			joinURL = &urls.JoinURL
			hostURL = &urls.HostURL
		case "bbb":
			if prov := d.bbbProvider(); prov != nil {
				urls, err := prov.CreateMeeting(ctx, meetingParams)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, fmt.Sprintf("Failed to create BBB room: %v", err))
					return
				}
				joinURL = &urls.JoinURL
				hostURL = &urls.HostURL
			}
		}

		m, err := virtualmeetings.Create(ctx, d.Pool,
			*cid, userID, provider, title,
			scheduledStart, scheduledEnd,
			joinURL, hostURL, nil,
			sectionID,
		)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create meeting.")
			return
		}

		// Override the auto-generated ID with the one we pre-computed for the room name.
		// (The DB assigns its own UUID; we keep the DB value — meetingUUID was for room naming only.)

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(m)
	}
}
