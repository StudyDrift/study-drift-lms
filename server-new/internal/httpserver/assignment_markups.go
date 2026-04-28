package httpserver

import (
	"encoding/json"
	"net/http"
)

// handleListAssignmentMarkups is GET /api/v1/courses/{course_code}/assignments/{item_id}/markups.
// Reader markups persistence is not ported yet in server-new; return a schema-compatible empty list.
func (d Deps) handleListAssignmentMarkups() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, _, ok := d.requireCourseAccess(w, r); !ok {
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"markups": []any{}})
	}
}

