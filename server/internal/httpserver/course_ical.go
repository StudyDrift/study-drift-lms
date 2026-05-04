package httpserver

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
)

// handleCourseICS is GET /api/v1/courses/{course_code}/calendar.ics — minimal iCalendar with term VEVENT when present.
func (d Deps) handleCourseICS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
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
		hasAccess, err := enrollment.UserHasAccess(ctx, d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !hasAccess {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		crow, err := course.GetPublicByCourseCode(ctx, d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		if crow.Term == nil {
			w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
			_, _ = w.Write([]byte("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lextures//Course//EN\r\nEND:VCALENDAR\r\n"))
			return
		}
		t := crow.Term
		uid := fmt.Sprintf("term-%s@lextures", t.ID)
		lines := []string{
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Lextures//Course//EN",
			"BEGIN:VEVENT",
			"UID:" + icalEscapeText(uid),
			"DTSTAMP:" + time.Now().UTC().Format("20060102T150405Z"),
			"SUMMARY:" + icalEscapeText(t.Name),
			"DTSTART;VALUE=DATE:" + strings.ReplaceAll(t.StartDate, "-", ""),
			"DTEND;VALUE=DATE:" + formatIcalEndExclusive(t.EndDate),
			"END:VEVENT",
			"END:VCALENDAR",
		}
		w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
		_, _ = w.Write([]byte(strings.Join(lines, "\r\n") + "\r\n"))
	}
}

func icalEscapeText(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, ";", "\\;")
	s = strings.ReplaceAll(s, ",", "\\,")
	s = strings.ReplaceAll(s, "\n", "\\n")
	return s
}

// formatIcalEndExclusive returns end date as exclusive end (next day) per all-day VEVENT convention.
func formatIcalEndExclusive(yyyyMMdd string) string {
	t, err := time.Parse("2006-01-02", yyyyMMdd)
	if err != nil {
		return strings.ReplaceAll(yyyyMMdd, "-", "")
	}
	return t.AddDate(0, 0, 1).Format("20060102")
}
