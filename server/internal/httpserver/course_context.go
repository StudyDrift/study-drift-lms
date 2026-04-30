package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/models/useraudit"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	userauditrepo "github.com/lextures/lextures/server/internal/repos/useraudit"
)

// handlePostCourseContext records LMS navigation in user.user_audit (Rust: post_course_context_handler).
func (d Deps) handlePostCourseContext() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		courseCode := strings.TrimSpace(chi.URLParam(r, "course_code"))
		if courseCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
			return
		}
		var req useraudit.PostCourseContextRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		kind := strings.TrimSpace(req.Kind)
		if ok, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, userID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not verify access.")
			return
		} else if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		switch kind {
		case "course_visit":
			if req.StructureItemID != nil && strings.TrimSpace(*req.StructureItemID) != "" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "course_visit must not include structureItemId.")
				return
			}
			if err := userauditrepo.Insert(r.Context(), d.Pool, userID, *cid, nil, "course_visit"); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not record activity.")
				return
			}
		case "content_open", "content_leave":
			if req.StructureItemID == nil || strings.TrimSpace(*req.StructureItemID) == "" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "content_open and content_leave require structureItemId.")
				return
			}
			sid, perr := uuid.Parse(strings.TrimSpace(*req.StructureItemID))
			if perr != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid structureItemId.")
				return
			}
			isPage, err := userauditrepo.StructureItemIsCourseContentPage(r.Context(), d.Pool, *cid, sid)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not verify content item.")
				return
			}
			if !isPage {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
			if err := userauditrepo.Insert(r.Context(), d.Pool, userID, *cid, &sid, kind); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not record activity.")
				return
			}
		default:
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid kind. Expected course_visit, content_open, or content_leave.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
