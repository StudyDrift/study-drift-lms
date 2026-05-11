package httpserver

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursefiles"
	"github.com/lextures/lextures/server/internal/courseroles"
)

// handlePostFactoryResetCourse is POST /api/v1/courses/{course_code}/factory-reset.
func (d Deps) handlePostFactoryResetCourse() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		canEdit, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			log.Printf("factory-reset: permission check failed course=%q viewer=%s err=%v", courseCode, viewer.String(), err)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canEdit {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}

		outcome, err := course.FactoryResetCourse(r.Context(), d.Pool, courseCode)
		if err != nil {
			log.Printf("factory-reset: reset failed course=%q viewer=%s err=%v", courseCode, viewer.String(), err)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to reset course.")
			return
		}
		if outcome == nil || outcome.Course == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		coursefiles.RemoveStoredBlobs(d.effectiveConfig().CourseFilesRoot, courseCode, outcome.RemovedCourseFileStorageKeys)
		log.Printf(
			"factory-reset: success course=%q viewer=%s removed_file_blobs=%d",
			courseCode,
			viewer.String(),
			len(outcome.RemovedCourseFileStorageKeys),
		)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(outcome.Course)
	}
}

