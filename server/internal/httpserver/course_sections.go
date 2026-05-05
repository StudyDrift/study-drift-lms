package httpserver

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursesections"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

func sectionJSON(s *coursesections.Section) map[string]any {
	if s == nil {
		return nil
	}
	out := map[string]any{
		"id":          s.ID.String(),
		"courseId":    s.CourseID.String(),
		"sectionCode": s.SectionCode,
		"status":      s.Status,
		"meetingInfo": json.RawMessage(s.MeetingInfo),
		"createdAt":   s.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updatedAt":   s.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if s.TermID != nil {
		out["termId"] = s.TermID.String()
	}
	if s.Name != nil {
		out["name"] = *s.Name
	}
	if s.InstructorUserID != nil {
		out["instructorUserId"] = s.InstructorUserID.String()
	}
	if s.Capacity != nil {
		out["capacity"] = *s.Capacity
	}
	return out
}

func (d Deps) handleCourseSectionsCollection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		pub, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || pub == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if !pub.SectionsEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Sections are not enabled for this course.")
			return
		}

		switch r.Method {
		case http.MethodGet:
			list, err := coursesections.ListForCourse(r.Context(), d.Pool, *cid)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list sections.")
				return
			}
			arr := make([]map[string]any, 0, len(list))
			for i := range list {
				arr = append(arr, sectionJSON(&list[i]))
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{"sections": arr})
			return

		case http.MethodPost:
			can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
				return
			}
			if !can {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to create sections.")
				return
			}
			var body struct {
				SectionCode      string          `json:"sectionCode"`
				Name             *string         `json:"name"`
				TermID           *string         `json:"termId"`
				InstructorUserID *string         `json:"instructorUserId"`
				Capacity         *int            `json:"capacity"`
				MeetingInfo      json.RawMessage `json:"meetingInfo"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			code := strings.TrimSpace(body.SectionCode)
			if code == "" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "sectionCode is required.")
				return
			}
			var termID *uuid.UUID
			if body.TermID != nil && strings.TrimSpace(*body.TermID) != "" {
				t, err := uuid.Parse(strings.TrimSpace(*body.TermID))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid termId.")
					return
				}
				termID = &t
			}
			var instID *uuid.UUID
			if body.InstructorUserID != nil && strings.TrimSpace(*body.InstructorUserID) != "" {
				u, err := uuid.Parse(strings.TrimSpace(*body.InstructorUserID))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid instructorUserId.")
					return
				}
				instID = &u
			}
			mi := body.MeetingInfo
			if len(mi) == 0 {
				mi = json.RawMessage(`{}`)
			}
			sec, err := coursesections.Create(r.Context(), d.Pool, *cid, code, body.Name, termID, instID, body.Capacity, mi)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not create section (duplicate code or invalid reference).")
				return
			}
			w.WriteHeader(http.StatusCreated)
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(sectionJSON(sec))
			return

		default:
			w.Header().Set("Allow", http.MethodGet+","+http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

func (d Deps) handleCourseSectionItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		sid, err := uuid.Parse(chi.URLParam(r, "section_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid section id.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		pub, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || pub == nil || !pub.SectionsEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Sections are not enabled for this course.")
			return
		}
		sec, err := coursesections.GetByID(r.Context(), d.Pool, *cid, sid)
		if err != nil || sec == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Section not found.")
			return
		}

		switch r.Method {
		case http.MethodPatch:
			can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
				return
			}
			if !can {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to update this section.")
				return
			}
			var body struct {
				SectionCode      *string          `json:"sectionCode"`
				Name             *string          `json:"name"`
				TermID           *string          `json:"termId"`
				ClearTermID      bool             `json:"clearTermId"`
				InstructorUserID *string          `json:"instructorUserId"`
				ClearInstructor  bool             `json:"clearInstructor"`
				Capacity         *int             `json:"capacity"`
				ClearCapacity    bool             `json:"clearCapacity"`
				MeetingInfo      *json.RawMessage `json:"meetingInfo"`
				Status           *string          `json:"status"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			patch := coursesections.Patch{}
			if body.SectionCode != nil {
				s := strings.TrimSpace(*body.SectionCode)
				if s == "" {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "sectionCode cannot be empty.")
					return
				}
				patch.SectionCode = &s
			}
			if body.Name != nil {
				patch.Name = body.Name
			}
			if body.ClearTermID {
				patch.ClearTermID = true
			} else if body.TermID != nil {
				t, err := uuid.Parse(strings.TrimSpace(*body.TermID))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid termId.")
					return
				}
				patch.TermID = &t
			}
			if body.ClearInstructor {
				patch.ClearInstructor = true
			} else if body.InstructorUserID != nil {
				u, err := uuid.Parse(strings.TrimSpace(*body.InstructorUserID))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid instructorUserId.")
					return
				}
				patch.InstructorUserID = &u
			}
			if body.ClearCapacity {
				patch.ClearCapacity = true
			} else if body.Capacity != nil {
				patch.Capacity = body.Capacity
			}
			if body.MeetingInfo != nil {
				patch.MeetingInfo = body.MeetingInfo
			}
			if body.Status != nil {
				st := strings.TrimSpace(*body.Status)
				if st != "active" && st != "cancelled" && st != "archived" {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid status.")
					return
				}
				patch.Status = &st
			}
			out, err := coursesections.Update(r.Context(), d.Pool, *cid, sid, patch)
			if err != nil || out == nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update section.")
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(sectionJSON(out))
			return

		case http.MethodDelete:
			can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
				return
			}
			if !can {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to archive this section.")
				return
			}
			if err := coursesections.SetStatus(r.Context(), d.Pool, *cid, sid, "archived"); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to archive section.")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return

		default:
			w.Header().Set("Allow", http.MethodPatch+","+http.MethodDelete+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

func (d Deps) handleEnrollmentSectionTransfer() http.HandlerFunc {
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
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		eid, err := uuid.Parse(chi.URLParam(r, "enrollment_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid enrollment id.")
			return
		}
		var body struct {
			SectionID string `json:"sectionId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		newSec, err := uuid.Parse(strings.TrimSpace(body.SectionID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid sectionId.")
			return
		}
		var courseCode string
		err = d.Pool.QueryRow(r.Context(), `
SELECT c.course_code FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE ce.id = $1
`, eid).Scan(&courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Enrollment not found.")
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, viewer)
		if err != nil || !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":enrollments:update")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to transfer enrollments.")
			return
		}
		pub, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || pub == nil || !pub.SectionsEnabled {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Sections are not enabled for this course.")
			return
		}
		slog.Info("enrollment.section_transfer", "enrollment_id", eid.String(), "section_id", newSec.String(), "actor_user_id", viewer.String())
		err = coursesections.TransferEnrollment(r.Context(), d.Pool, eid, newSec)
		if err != nil {
			if err == coursesections.ErrNotStudentEnrollment || err == coursesections.ErrSectionCourseMismatch {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid section transfer.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to transfer enrollment.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

func (d Deps) handleSectionAssignmentOverride() http.HandlerFunc {
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
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		sid, err := uuid.Parse(chi.URLParam(r, "section_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid section id.")
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "item_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid item id.")
			return
		}
		var courseID uuid.UUID
		var courseCode string
		err = d.Pool.QueryRow(r.Context(), `
SELECT c.id, c.course_code FROM course.course_sections s
INNER JOIN course.courses c ON c.id = s.course_id
WHERE s.id = $1
`, sid).Scan(&courseID, &courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Section not found.")
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, viewer)
		if err != nil || !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil || !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to set overrides.")
			return
		}
		pub, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || pub == nil || !pub.SectionsEnabled {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Sections are not enabled for this course.")
			return
		}
		row, err := coursestructure.GetItemRow(r.Context(), d.Pool, courseID, itemID)
		if err != nil || row == nil || row.Kind != "assignment" {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Assignment not found in course.")
			return
		}
		var body struct {
			DueAt          *time.Time `json:"dueAt"`
			AvailableFrom  *time.Time `json:"availableFrom"`
			AvailableUntil *time.Time `json:"availableUntil"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if err := coursesections.UpsertOverride(r.Context(), d.Pool, sid, itemID, body.DueAt, body.AvailableFrom, body.AvailableUntil); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save override.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

func applySectionAssignmentOverrides(items []coursestructure.ItemResponse, ovm map[uuid.UUID]coursesections.Override) {
	for i := range items {
		if items[i].Kind != "assignment" {
			continue
		}
		id, err := uuid.Parse(items[i].ID)
		if err != nil {
			continue
		}
		ov, ok := ovm[id]
		if !ok {
			continue
		}
		if ov.DueAt != nil {
			t := *ov.DueAt
			items[i].DueAt = &t
		}
	}
}
