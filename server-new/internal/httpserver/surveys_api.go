package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/models/coursemodulesurvey"
	"github.com/lextures/lextures/server-new/internal/repos/course"
	"github.com/lextures/lextures/server-new/internal/repos/coursegrants"
	"github.com/lextures/lextures/server-new/internal/repos/coursemodulesurveys"
	"github.com/lextures/lextures/server-new/internal/repos/coursestructure"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
)

func (d Deps) handleListCourseSurveys() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		perm := coursegrants.CourseItemsCreatePermission(courseCode)
		can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permission.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
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
		list, err := coursemodulesurveys.ListForCourse(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list surveys.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(list)
	}
}

func (d Deps) handleCreateCourseSurvey() http.HandlerFunc {
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
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		perm := coursegrants.CourseItemsCreatePermission(courseCode)
		can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permission.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		var req coursemodulesurvey.CreateCourseSurveyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON.")
			return
		}
		title := strings.TrimSpace(req.Title)
		if title == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Survey title is required.")
			return
		}
		mode := strings.TrimSpace(req.AnonymityMode)
		if mode == "" {
			mode = "identified"
		}
		if !coursemodulesurvey.ValidateAnonymityMode(mode) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "anonymityMode must be identified, anonymous, or pseudo_anonymous.")
			return
		}
		if req.OpensAt != nil && req.ClosesAt != nil && req.OpensAt.After(*req.ClosesAt) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "opensAt must be before closesAt.")
			return
		}
		if err := coursemodulesurvey.ValidateQuestions(req.Questions); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			} else {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			}
			return
		}
		newID, err := coursestructure.InsertSurveyUnderModule(r.Context(), d.Pool, *cid, req.ModuleID, title)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create survey.")
			return
		}
		desc := strings.TrimSpace(req.Description)
		saved, err := coursemodulesurveys.UpdateSurvey(r.Context(), d.Pool, newID, nil, &desc, &mode, req.OpensAt, req.ClosesAt, &req.Questions)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save survey.")
			return
		}
		if saved == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(saved)
	}
}

func (d Deps) handleGetSurvey() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		survey, err := coursemodulesurveys.GetForItem(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load survey.")
			return
		}
		if survey == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		cc, err := course.GetCourseCodeByID(r.Context(), d.Pool, survey.CourseID)
		if err != nil || cc == nil {
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			} else {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			}
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, *cc, viewer)
		if err != nil || !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		perm := coursegrants.CourseItemsCreatePermission(*cc)
		canEdit, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permission.")
			return
		}
		if !canEdit {
			vis, err := coursestructure.SurveyVisibleToStudent(r.Context(), d.Pool, survey.CourseID, id, viewer, time.Now().UTC())
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check visibility.")
				return
			}
			if !vis {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(survey)
	}
}

func (d Deps) handlePutSurvey() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		var req coursemodulesurvey.UpdateSurveyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON.")
			return
		}
		current, err := coursemodulesurveys.GetForItem(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load survey.")
			return
		}
		if current == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		cc, err := course.GetCourseCodeByID(r.Context(), d.Pool, current.CourseID)
		if err != nil || cc == nil {
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			} else {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			}
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, *cc, viewer)
		if err != nil || !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		perm := coursegrants.CourseItemsCreatePermission(*cc)
		can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permission.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		if req.Title != nil && strings.TrimSpace(*req.Title) == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Survey title is required.")
			return
		}
		if req.AnonymityMode != nil && !coursemodulesurvey.ValidateAnonymityMode(strings.TrimSpace(*req.AnonymityMode)) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "anonymityMode must be identified, anonymous, or pseudo_anonymous.")
			return
		}
		if req.Questions != nil {
			if err := coursemodulesurvey.ValidateQuestions(*req.Questions); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
				return
			}
		}
		if req.OpensAt != nil && req.ClosesAt != nil && req.OpensAt.After(*req.ClosesAt) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "opensAt must be before closesAt.")
			return
		}
		var titlePtr, descPtr, modePtr *string
		if req.Title != nil {
			t := strings.TrimSpace(*req.Title)
			titlePtr = &t
		}
		if req.Description != nil {
			d := strings.TrimSpace(*req.Description)
			descPtr = &d
		}
		if req.AnonymityMode != nil {
			m := strings.TrimSpace(*req.AnonymityMode)
			modePtr = &m
		}
		updated, err := coursemodulesurveys.UpdateSurvey(r.Context(), d.Pool, id, titlePtr, descPtr, modePtr, req.OpensAt, req.ClosesAt, req.Questions)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update survey.")
			return
		}
		if updated == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(updated)
	}
}

func (d Deps) handleSurveyRespond() http.HandlerFunc {
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
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		var req coursemodulesurvey.SubmitSurveyResponseRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON.")
			return
		}
		if len(req.Answers) == 0 {
			req.Answers = []byte(`{}`)
		}
		survey, err := coursemodulesurveys.GetForItem(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load survey.")
			return
		}
		if survey == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		cc, err := course.GetCourseCodeByID(r.Context(), d.Pool, survey.CourseID)
		if err != nil || cc == nil {
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			} else {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			}
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, *cc, viewer)
		if err != nil || !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		vis, err := coursestructure.SurveyVisibleToStudent(r.Context(), d.Pool, survey.CourseID, id, viewer, time.Now().UTC())
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check visibility.")
			return
		}
		if !vis {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		known, already, err := coursemodulesurveys.SubmitResponse(r.Context(), d.Pool, id, viewer, req.Answers)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to submit response.")
			return
		}
		if !known {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		out := coursemodulesurvey.SubmitSurveyResponse{Submitted: true}
		if already {
			t := true
			out.AlreadySubmitted = &t
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (d Deps) handleSurveyResults() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		survey, err := coursemodulesurveys.GetForItem(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load survey.")
			return
		}
		if survey == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		cc, err := course.GetCourseCodeByID(r.Context(), d.Pool, survey.CourseID)
		if err != nil || cc == nil {
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			} else {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			}
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, *cc, viewer)
		if err != nil || !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		perm := coursegrants.CourseItemsCreatePermission(*cc)
		can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permission.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		n, questions, err := coursemodulesurveys.AggregateResults(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to aggregate results.")
			return
		}
		out := coursemodulesurvey.SurveyResultsResponse{
			ResponseCount: n,
			Questions:     questions,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}
