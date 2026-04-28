package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
	"github.com/lextures/lextures/server-new/internal/repos/recommendations"
)

func (d Deps) handleRecommendationEvent() http.HandlerFunc {
	type req struct {
		CourseID  string  `json:"courseId"`
		ItemID    *string `json:"itemId"`
		Surface   string  `json:"surface"`
		EventType string  `json:"eventType"`
		Rank      *int16  `json:"rank"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		et := strings.TrimSpace(in.EventType)
		if !containsStr([]string{"impression", "click", "dismiss"}, et) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "eventType must be impression, click, or dismiss.")
			return
		}
		cid, err := uuid.Parse(strings.TrimSpace(in.CourseID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "courseId must be a UUID.")
			return
		}
		okAcc, err := enrollment.UserHasAccessByCourseID(r.Context(), d.Pool, cid, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !okAcc {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		var itemID *uuid.UUID
		if in.ItemID != nil && strings.TrimSpace(*in.ItemID) != "" {
			u, err := uuid.Parse(strings.TrimSpace(*in.ItemID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "itemId must be a UUID.")
				return
			}
			itemID = &u
		}
		surface := strings.TrimSpace(in.Surface)
		if err := recommendations.InsertEvent(r.Context(), d.Pool, viewer, cid, itemID, surface, et, in.Rank); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to record event.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

func containsStr(hay []string, needle string) bool {
	for _, h := range hay {
		if h == needle {
			return true
		}
	}
	return false
}
