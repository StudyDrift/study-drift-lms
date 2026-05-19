package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/officehours"
)

// handleListAvailabilitySlots is GET /api/v1/courses/{course_code}/availability.
// Returns upcoming availability windows and appointment slots for the next 4 weeks.
func (d Deps) handleListAvailabilitySlots() http.HandlerFunc {
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

		isStaff, _ := enrollment.UserIsCourseStaff(ctx, d.Pool, courseCode, userID)

		windows, err := officehours.ListWindowsByCourse(ctx, d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load availability windows.")
			return
		}
		slots, err := officehours.ListSlotsByCourse(ctx, d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load slots.")
			return
		}

		// Students only see their own notes; redact other students' notes.
		if !isStaff {
			for _, s := range slots {
				if s.StudentID != nil && s.StudentID != (*string)(nil) {
					studentIDStr := ""
					if s.StudentID != nil {
						studentIDStr = *s.StudentID
					}
					if studentIDStr != userID.String() {
						// Hide note and student identity from other students.
						s.StudentNote = nil
						if studentIDStr != userID.String() {
							// Keep status (booked/available) but clear PII.
							s.StudentID = nil
						}
					}
				}
			}
		}

		if windows == nil {
			windows = []*officehours.AvailabilityWindow{}
		}
		if slots == nil {
			slots = []*officehours.AppointmentSlot{}
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"windows": windows,
			"slots":   slots,
		})
	}
}

// handleGetMyAppointments is GET /api/v1/me/appointments.
func (d Deps) handleGetMyAppointments() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		appointments, err := officehours.ListMyAppointments(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load appointments.")
			return
		}
		if appointments == nil {
			appointments = []*officehours.AppointmentSlot{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"appointments": appointments})
	}
}

// handleGetSlotIcal is GET /api/v1/slots/{slot_id}/ical — RFC 5545 VCALENDAR download.
func (d Deps) handleGetSlotIcal() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		slotIDStr := chi.URLParam(r, "slot_id")
		slotID, err := uuid.Parse(slotIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid slot ID.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		slot, err := officehours.GetSlotByID(ctx, d.Pool, slotID)
		if err != nil || slot == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Slot not found.")
			return
		}

		window, err := officehours.GetWindowBySlotID(ctx, d.Pool, slotID)
		if err != nil || window == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Slot not found.")
			return
		}

		// Only the booked student and the instructor can download the iCal.
		isOwner := slot.StudentID != nil && *slot.StudentID == userID.String()
		isInstructor := window.InstructorID == userID.String()
		if !isOwner && !isInstructor {
			if window.CourseID != nil {
				cid, parseErr := uuid.Parse(*window.CourseID)
				if parseErr != nil {
					apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
					return
				}
				hasAccess, _ := enrollment.UserHasAccessByCourseID(ctx, d.Pool, cid, userID)
				if !hasAccess {
					apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
					return
				}
			} else {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
				return
			}
		}

		dtstamp := slot.SlotStart.UTC().Format("20060102T150405Z")
		dtstart := slot.SlotStart.UTC().Format("20060102T150405Z")
		dtend := slot.SlotEnd.UTC().Format("20060102T150405Z")

		summary := "Office Hours"
		location := ""
		if window.Location != nil && *window.Location != "" {
			location = *window.Location
		}

		lines := []string{
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Lextures//Office Hours//EN",
			"BEGIN:VEVENT",
			"UID:" + icalEscapeText(fmt.Sprintf("slot-%s@lextures", slot.ID)),
			"DTSTAMP:" + dtstamp,
			"DTSTART:" + dtstart,
			"DTEND:" + dtend,
			"SUMMARY:" + icalEscapeText(summary),
		}
		if location != "" {
			lines = append(lines, "LOCATION:"+icalEscapeText(location))
		}
		lines = append(lines, "END:VEVENT", "END:VCALENDAR")

		w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="appointment-%s.ics"`, slot.ID[:8]))
		_, _ = w.Write([]byte(strings.Join(lines, "\r\n") + "\r\n"))
	}
}

func (d Deps) registerOfficeHoursRoutes(r chi.Router) {
	r.Post("/api/v1/courses/{course_code}/availability", d.handleCreateAvailabilityWindow())
	r.Get("/api/v1/courses/{course_code}/availability", d.handleListAvailabilitySlots())
	r.Post("/api/v1/slots/{slot_id}/book", d.handleBookSlot())
	r.Delete("/api/v1/slots/{slot_id}/book", d.handleCancelBooking())
	r.Get("/api/v1/me/appointments", d.handleGetMyAppointments())
	r.Get("/api/v1/slots/{slot_id}/ical", d.handleGetSlotIcal())
}
