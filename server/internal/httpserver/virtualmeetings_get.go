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
)

// handleListMeetings is GET /api/v1/courses/{course_code}/meetings.
func (d Deps) handleListMeetings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode := chi.URLParam(r, "course_code")
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		hasAccess, err := enrollment.UserHasAccess(ctx, d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !hasAccess {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		meetings, err := virtualmeetings.ListByCourse(ctx, d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load meetings.")
			return
		}
		if meetings == nil {
			meetings = []*virtualmeetings.Meeting{}
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"meetings": meetings})
	}
}

// handleGetMeetingJoin is GET /api/v1/meetings/{meeting_id}/join.
func (d Deps) handleGetMeetingJoin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
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
		hasAccess, err := enrollment.UserHasAccessByCourseID(ctx, d.Pool, courseID, userID)
		if err != nil || !hasAccess {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have access to this meeting.")
			return
		}

		if m.Status == "cancelled" {
			apierr.WriteJSON(w, http.StatusGone, apierr.CodeNotFound, "Meeting was cancelled.")
			return
		}

		isStaff, _ := enrollment.UserHasAccessByCourseID(ctx, d.Pool, courseID, userID)

		joinURL := ""
		if m.JoinURL != nil {
			joinURL = *m.JoinURL
		}
		hostURL := ""
		if m.HostURL != nil {
			hostURL = *m.HostURL
		}

		// Track attendance when joining a live session.
		if m.Status == "live" {
			_, _ = virtualmeetings.UpsertAttendance(ctx, d.Pool, mid, userID)
		}

		resp := map[string]interface{}{
			"joinUrl":   joinURL,
			"meetingId": m.ID,
			"status":    m.Status,
		}
		if isStaff && hostURL != "" {
			resp["hostUrl"] = hostURL
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// handleGetMeetingAttendance is GET /api/v1/meetings/{meeting_id}/attendance.
func (d Deps) handleGetMeetingAttendance() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
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
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only instructors can view attendance.")
			return
		}

		records, err := virtualmeetings.ListAttendance(ctx, d.Pool, mid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load attendance.")
			return
		}
		if records == nil {
			records = []*virtualmeetings.AttendanceRecord{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"attendance": records})
	}
}

// handleGetMeetingIcal is GET /api/v1/meetings/{meeting_id}/ical — RFC 5545 VCALENDAR download.
func (d Deps) handleGetMeetingIcal() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
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
		hasAccess, err := enrollment.UserHasAccessByCourseID(ctx, d.Pool, courseID, userID)
		if err != nil || !hasAccess {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have access to this meeting.")
			return
		}

		now := time.Now().UTC()
		dtstamp := now.Format("20060102T150405Z")

		var dtstart, dtend string
		if m.ScheduledStart != nil {
			dtstart = m.ScheduledStart.UTC().Format("20060102T150405Z")
		} else {
			dtstart = dtstamp
		}
		if m.ScheduledEnd != nil {
			dtend = m.ScheduledEnd.UTC().Format("20060102T150405Z")
		} else if m.ScheduledStart != nil {
			dtend = m.ScheduledStart.Add(time.Hour).UTC().Format("20060102T150405Z")
		} else {
			dtend = now.Add(time.Hour).UTC().Format("20060102T150405Z")
		}

		joinURL := ""
		if m.JoinURL != nil {
			joinURL = *m.JoinURL
		}

		lines := []string{
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Lextures//Virtual Classroom//EN",
			"BEGIN:VEVENT",
			"UID:" + icalEscapeText(fmt.Sprintf("meeting-%s@lextures", m.ID)),
			"DTSTAMP:" + dtstamp,
			"DTSTART:" + dtstart,
			"DTEND:" + dtend,
			"SUMMARY:" + icalEscapeText(m.Title),
		}
		if joinURL != "" {
			lines = append(lines, "URL:"+icalEscapeText(joinURL))
			lines = append(lines, "DESCRIPTION:Join at "+icalEscapeText(joinURL))
		}
		lines = append(lines, "END:VEVENT", "END:VCALENDAR")

		w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="meeting-%s.ics"`, m.ID[:8]))
		_, _ = w.Write([]byte(strings.Join(lines, "\r\n") + "\r\n"))
	}
}

func (d Deps) registerMeetingRoutes(r chi.Router) {
	r.Post("/api/v1/courses/{course_code}/meetings", d.handleCreateMeeting())
	r.Get("/api/v1/courses/{course_code}/meetings", d.handleListMeetings())
	r.Get("/api/v1/meetings/{meeting_id}/join", d.handleGetMeetingJoin())
	r.Patch("/api/v1/meetings/{meeting_id}", d.handlePatchMeeting())
	r.Get("/api/v1/meetings/{meeting_id}/attendance", d.handleGetMeetingAttendance())
	r.Get("/api/v1/meetings/{meeting_id}/ical", d.handleGetMeetingIcal())
}
