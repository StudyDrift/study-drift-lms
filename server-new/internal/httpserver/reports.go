package httpserver

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/models/reports"
	reporeports "github.com/lextures/lextures/server-new/internal/repos/reports"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
)

const permGlobalReportsView = "global:app:reports:view"

func (d Deps) handleLearningActivityReport() http.HandlerFunc {
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
		has, err := rbac.UserHasPermission(ctx, d.Pool, userID, permGlobalReportsView)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check permissions.")
			return
		}
		if !has {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		from, to, err := parseLearningActivityTimeRange(r.URL.Query(), timeNowUTC())
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		summary, err := reporeports.LearningActivitySummary(ctx, d.Pool, from, to)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load report.")
			return
		}
		byDay, err := reporeports.LearningActivityByDay(ctx, d.Pool, from, to)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load report.")
			return
		}
		byKind, err := reporeports.LearningActivityByEventKind(ctx, d.Pool, from, to)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load report.")
			return
		}
		top, err := reporeports.LearningActivityTopCourses(ctx, d.Pool, from, to, learningActivityTopCoursesLimit)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load report.")
			return
		}
		out := reports.LearningActivityReport{
			Range: reports.DateRange{From: from, To: to},
			Summary: summary,
			ByDay:  byDay,
			ByEventKind: byKind,
			TopCourses:  top,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// timeNowUTC is a test seam (monotonic clock not required).
var timeNowUTC = func() time.Time { return time.Now().UTC() }
