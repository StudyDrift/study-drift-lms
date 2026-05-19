package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/officehours"
)

type createWindowBody struct {
	DayOfWeek           *int    `json:"dayOfWeek"`
	WindowDate          *string `json:"windowDate"`
	StartTime           string  `json:"startTime"`
	EndTime             string  `json:"endTime"`
	SlotDurationMinutes *int    `json:"slotDurationMinutes"`
	Location            *string `json:"location"`
	IsVirtual           bool    `json:"isVirtual"`
}

// handleCreateAvailabilityWindow is POST /api/v1/courses/{course_code}/availability.
func (d Deps) handleCreateAvailabilityWindow() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode := chi.URLParam(r, "course_code")
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
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only instructors can create availability windows.")
			return
		}

		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		var body createWindowBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}

		startTime := strings.TrimSpace(body.StartTime)
		endTime := strings.TrimSpace(body.EndTime)
		if startTime == "" || endTime == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "startTime and endTime are required.")
			return
		}
		if body.DayOfWeek == nil && body.WindowDate == nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Either dayOfWeek (recurring) or windowDate (one-off) is required.")
			return
		}
		if body.DayOfWeek != nil && body.WindowDate != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Provide dayOfWeek or windowDate, not both.")
			return
		}
		if body.DayOfWeek != nil && (*body.DayOfWeek < 0 || *body.DayOfWeek > 6) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "dayOfWeek must be 0–6 (Sun–Sat).")
			return
		}

		slotDuration := 15
		if body.SlotDurationMinutes != nil && *body.SlotDurationMinutes > 0 {
			slotDuration = *body.SlotDurationMinutes
		}

		window, slots, err := officehours.CreateWindow(
			ctx, d.Pool,
			userID, cid,
			body.DayOfWeek, body.WindowDate,
			startTime, endTime,
			slotDuration, body.Location, body.IsVirtual,
		)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create availability window.")
			return
		}

		if slots == nil {
			slots = []*officehours.AppointmentSlot{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"window": window,
			"slots":  slots,
		})
	}
}

type bookSlotBody struct {
	Note *string `json:"note"`
}

// handleBookSlot is POST /api/v1/slots/{slot_id}/book.
func (d Deps) handleBookSlot() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
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

		// Verify slot exists and the user has access to the course.
		slot, err := officehours.GetSlotByID(ctx, d.Pool, slotID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load slot.")
			return
		}
		if slot == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Slot not found.")
			return
		}

		window, err := officehours.GetWindowBySlotID(ctx, d.Pool, slotID)
		if err != nil || window == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Slot not found.")
			return
		}
		if window.CourseID != nil {
			cid, parseErr := uuid.Parse(*window.CourseID)
			if parseErr != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course ID.")
				return
			}
			hasAccess, accessErr := enrollment.UserHasAccessByCourseID(ctx, d.Pool, cid, userID)
			if accessErr != nil || !hasAccess {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You are not enrolled in this course.")
				return
			}
		}

		var body bookSlotBody
		_ = json.NewDecoder(r.Body).Decode(&body)

		booked, err := officehours.BookSlot(ctx, d.Pool, slotID, userID, body.Note)
		if err == officehours.ErrAlreadyBooked {
			apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, "Slot already booked.")
			return
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to book slot.")
			return
		}
		if booked == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Slot not found.")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(booked)
	}
}
