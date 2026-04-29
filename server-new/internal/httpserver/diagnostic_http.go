package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
	"github.com/lextures/lextures/server-new/internal/repos/concepts"
	"github.com/lextures/lextures/server-new/internal/repos/course"
	"github.com/lextures/lextures/server-new/internal/repos/coursegrants"
	diagrepo "github.com/lextures/lextures/server-new/internal/repos/diagnostic"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
	diagsvc "github.com/lextures/lextures/server-new/internal/service/diagnostic"
)

func (d Deps) handleEnrollmentDiagnosticGet() http.HandlerFunc {
	type attemptPub struct {
		ID               string          `json:"id"`
		StartedAt        string          `json:"startedAt"`
		CompletedAt      *string         `json:"completedAt,omitempty"`
		Bypassed         bool            `json:"bypassed"`
		PlacementSummary json.RawMessage `json:"placementSummary,omitempty"`
	}
	type respBody struct {
		Status       string      `json:"status"`
		DiagnosticID *string     `json:"diagnosticId,omitempty"`
		Attempt      *attemptPub `json:"attempt,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		eid, err := uuid.Parse(chi.URLParam(r, "enrollmentID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid enrollment id.")
			return
		}
		en, err := enrollment.GetByID(r.Context(), d.Pool, eid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollment.")
			return
		}
		if en == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Enrollment not found.")
			return
		}
		if en.UserID != viewer {
			perm := coursegrants.CourseEnrollmentsReadPermission(en.CourseCode)
			has, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
			if err != nil || !has {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
				return
			}
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, en.CourseCode)
		if err != nil || crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		cid, err := uuid.Parse(crow.ID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		diag, err := diagrepo.GetDiagnosticForCourse(r.Context(), d.Pool, cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load diagnostic.")
			return
		}
		global := diagsvc.GloballyEnabled()
		active := diagsvc.ActiveForCourse(global, crow.DiagnosticAssessmentsEnabled, diag != nil)
		if !active {
			writeJSON(w, http.StatusOK, respBody{Status: "off"})
			return
		}
		if diag == nil {
			writeJSON(w, http.StatusOK, respBody{Status: "not_configured"})
			return
		}
		latest, err := diagrepo.LatestAttemptForEnrollment(r.Context(), d.Pool, diag.ID, eid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load attempt.")
			return
		}
		var attempt *attemptPub
		status := "pending"
		if latest != nil {
			sid := latest.ID.String()
			sa := latest.StartedAt.UTC().Format(time.RFC3339Nano)
			var ca *string
			if latest.CompletedAt != nil {
				t := latest.CompletedAt.UTC().Format(time.RFC3339Nano)
				ca = &t
			}
			var ps json.RawMessage
			if len(latest.PlacementSummary) > 0 {
				ps = latest.PlacementSummary
			}
			attempt = &attemptPub{
				ID:               sid,
				StartedAt:        sa,
				CompletedAt:      ca,
				Bypassed:         latest.Bypassed,
				PlacementSummary: ps,
			}
			switch {
			case latest.CompletedAt == nil:
				status = "in_progress"
			case latest.Bypassed:
				status = "bypassed"
			default:
				status = "completed"
			}
		}
		did := diag.ID.String()
		writeJSON(w, http.StatusOK, respBody{
			Status:       status,
			DiagnosticID: &did,
			Attempt:      attempt,
		})
	}
}

func (d Deps) handleEnrollmentDiagnosticStart() http.HandlerFunc {
	type startResp struct {
		AttemptID     string                                         `json:"attemptId"`
		FirstQuestion coursemodulequiz.AdaptiveQuizGeneratedQuestion `json:"firstQuestion"`
	}
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
		eid, err := uuid.Parse(chi.URLParam(r, "enrollmentID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid enrollment id.")
			return
		}
		en, err := enrollment.GetByID(r.Context(), d.Pool, eid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollment.")
			return
		}
		if en == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Enrollment not found.")
			return
		}
		if en.UserID != userID {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, en.CourseCode)
		if err != nil || crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		cid, err := uuid.Parse(crow.ID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		diag, err := diagrepo.GetDiagnosticForCourse(r.Context(), d.Pool, cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load diagnostic.")
			return
		}
		global := diagsvc.GloballyEnabled()
		active := diagsvc.ActiveForCourse(global, crow.DiagnosticAssessmentsEnabled, diag != nil)
		if !active {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Diagnostic assessments are not available for this course.")
			return
		}
		aid, q, err := diagsvc.StartOrResumeDiagnostic(r.Context(), d.Pool, cid, eid, userID)
		if err != nil {
			writeDiagnosticErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, startResp{AttemptID: aid.String(), FirstQuestion: q})
	}
}

func (d Deps) handleEnrollmentDiagnosticBypass() http.HandlerFunc {
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
		eid, err := uuid.Parse(chi.URLParam(r, "enrollmentID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid enrollment id.")
			return
		}
		en, err := enrollment.GetByID(r.Context(), d.Pool, eid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollment.")
			return
		}
		if en == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Enrollment not found.")
			return
		}
		if en.UserID != userID {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, en.CourseCode)
		if err != nil || crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		cid, err := uuid.Parse(crow.ID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		if err := diagsvc.BypassDiagnosticForEnrollment(r.Context(), d.Pool, cid, eid, userID); err != nil {
			writeDiagnosticErr(w, err)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

func (d Deps) handleDiagnosticAttemptRespond() http.HandlerFunc {
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
		aid, err := uuid.Parse(chi.URLParam(r, "attemptID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid attempt id.")
			return
		}
		att, err := diagrepo.GetAttemptByID(r.Context(), d.Pool, aid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load attempt.")
			return
		}
		if att == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Attempt not found.")
			return
		}
		en, err := enrollment.GetByID(r.Context(), d.Pool, att.EnrollmentID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollment.")
			return
		}
		if en == nil || en.UserID != userID {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}
		var body diagsvc.RespondBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, en.CourseCode)
		if err != nil || crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		cid, err := uuid.Parse(crow.ID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		out, err := diagsvc.RespondDiagnosticAttempt(r.Context(), d.Pool, cid, userID, aid, body)
		if err != nil {
			writeDiagnosticErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func (d Deps) handleCourseDiagnosticResults() http.HandlerFunc {
	type studentRow struct {
		EnrollmentID     string          `json:"enrollmentId"`
		UserID           string          `json:"userId"`
		DisplayName      *string         `json:"displayName,omitempty"`
		Email            *string         `json:"email,omitempty"`
		AttemptID        *string         `json:"attemptId,omitempty"`
		CompletedAt      *string         `json:"completedAt,omitempty"`
		Bypassed         *bool           `json:"bypassed,omitempty"`
		ThetaSummary     json.RawMessage `json:"thetaSummary,omitempty"`
		PlacementSummary json.RawMessage `json:"placementSummary,omitempty"`
	}
	type resultsResp struct {
		Students []studentRow `json:"students"`
	}
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
		courseCode := chi.URLParam(r, "course_code")
		if courseCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		perm := coursegrants.CourseEnrollmentsReadPermission(courseCode)
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, userID, perm)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		cid, err := uuid.Parse(crow.ID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		diag, err := diagrepo.GetDiagnosticForCourse(r.Context(), d.Pool, cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load diagnostic.")
			return
		}
		if diag == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Diagnostic not found.")
			return
		}
		rows, err := diagrepo.ListDiagnosticResultsForCourse(r.Context(), d.Pool, diag.ID, cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load results.")
			return
		}
		students := make([]studentRow, 0, len(rows))
		for _, row := range rows {
			sr := studentRow{
				EnrollmentID: row.EnrollmentID.String(),
				UserID:       row.UserID.String(),
				DisplayName:  row.DisplayName,
				Email:        row.Email,
				Bypassed:     row.Bypassed,
			}
			if row.AttemptID != nil {
				s := row.AttemptID.String()
				sr.AttemptID = &s
			}
			if row.CompletedAt != nil {
				t := row.CompletedAt.UTC().Format(time.RFC3339Nano)
				sr.CompletedAt = &t
			}
			if len(row.ThetaSummary) > 0 {
				sr.ThetaSummary = row.ThetaSummary
			}
			if len(row.PlacementSummary) > 0 {
				sr.PlacementSummary = row.PlacementSummary
			}
			students = append(students, sr)
		}
		writeJSON(w, http.StatusOK, resultsResp{Students: students})
	}
}

func (d Deps) handleCourseDiagnosticConfigGet() http.HandlerFunc {
	type cfgResp struct {
		Diagnostic *diagrepo.CourseDiagnosticRow `json:"diagnostic"`
	}
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
		courseCode := chi.URLParam(r, "course_code")
		if courseCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		perm := coursegrants.CourseItemsCreatePermission(courseCode)
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, userID, perm)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		cid, err := uuid.Parse(crow.ID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		diag, err := diagrepo.GetDiagnosticForCourse(r.Context(), d.Pool, cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load diagnostic.")
			return
		}
		writeJSON(w, http.StatusOK, cfgResp{Diagnostic: diag})
	}
}

func (d Deps) handleCourseDiagnosticConfigPut() http.HandlerFunc {
	type putBody struct {
		ConceptIDs     []uuid.UUID      `json:"conceptIds"`
		MaxItems       int32            `json:"maxItems"`
		StoppingRule   string           `json:"stoppingRule"`
		SEThreshold    float64          `json:"seThreshold"`
		RetakePolicy   string           `json:"retakePolicy"`
		PlacementRules json.RawMessage  `json:"placementRules"`
		ThetaCutScores *json.RawMessage `json:"thetaCutScores,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		courseCode := chi.URLParam(r, "course_code")
		if courseCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		perm := coursegrants.CourseItemsCreatePermission(courseCode)
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, userID, perm)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}
		var body putBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if body.MaxItems == 0 {
			body.MaxItems = 20
		}
		if body.StoppingRule == "" {
			body.StoppingRule = "both"
		}
		if body.SEThreshold == 0 {
			body.SEThreshold = 0.3
		}
		if body.RetakePolicy == "" {
			body.RetakePolicy = "once"
		}
		if len(body.PlacementRules) == 0 {
			body.PlacementRules = []byte("[]")
		}
		switch body.StoppingRule {
		case "max_items", "se_threshold", "both":
		default:
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "stoppingRule must be max_items, se_threshold, or both.")
			return
		}
		switch body.RetakePolicy {
		case "once", "per_term", "always":
		default:
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "retakePolicy must be once, per_term, or always.")
			return
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		if !crow.QuestionBankEnabled {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Enable the question bank for this course before configuring a diagnostic.")
			return
		}
		cid, err := uuid.Parse(crow.ID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		if err := concepts.ValidateConceptIDsForCourse(r.Context(), d.Pool, cid, body.ConceptIDs); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		maxItems := body.MaxItems
		if maxItems < 3 {
			maxItems = 3
		}
		if maxItems > 60 {
			maxItems = 60
		}
		se := body.SEThreshold
		if se < 0.05 {
			se = 0.05
		}
		if se > 1 {
			se = 1
		}
		row, err := diagrepo.UpsertCourseDiagnostic(
			r.Context(), d.Pool, cid, body.ConceptIDs, maxItems, body.StoppingRule, se, body.RetakePolicy, body.PlacementRules, body.ThetaCutScores,
		)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save diagnostic.")
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

func writeDiagnosticErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, diagsvc.ErrForbidden):
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
	case errors.Is(err, diagsvc.ErrNotFound):
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
	default:
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
	}
}
