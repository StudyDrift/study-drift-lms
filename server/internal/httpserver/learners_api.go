package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/learnermodel"
	"github.com/lextures/lextures/server/internal/repos/misconceptions"
	srssvc "github.com/lextures/lextures/server/internal/service/srs"
)

func (d Deps) handleLearnersConceptsBatch() http.HandlerFunc {
	type reqBody struct {
		UserIDs    []uuid.UUID  `json:"userIds"`
		ConceptIDs []uuid.UUID  `json:"conceptIds,omitempty"`
	}
	type conceptState struct {
		ConceptID        string  `json:"conceptId"`
		ConceptName      string  `json:"conceptName"`
		Mastery          float64 `json:"mastery"`
		AttemptCount     int32   `json:"attemptCount"`
		LastSeenAt       *string `json:"lastSeenAt,omitempty"`
		NeedsReviewAt    *string `json:"needsReviewAt,omitempty"`
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
		const maxBatch = 200
		var body reqBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if len(body.UserIDs) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "userIds must not be empty.")
			return
		}
		if len(body.UserIDs) > maxBatch {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "At most 200 user ids per request.")
			return
		}
		for _, uid := range body.UserIDs {
			can, err := assertCanReadLearnerState(r.Context(), d.Pool, viewer, uid)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
				return
			}
			if !can {
				writeLearnerAccessDenied(w)
				return
			}
		}
		rows, err := learnermodel.BatchListConceptStatesForUsers(r.Context(), d.Pool, body.UserIDs, body.ConceptIDs, maxBatch)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load learner states.")
			return
		}
		states := make(map[string][]conceptState)
		for _, u := range body.UserIDs {
			states[u.String()] = []conceptState{}
		}
		for _, pair := range rows {
			ls := states[pair.UserID.String()]
			var lastSeen, needs *string
			if pair.Row.LastSeenAt != nil {
				s := pair.Row.LastSeenAt.UTC().Format(rfc3339Millis)
				lastSeen = &s
			}
			if pair.Row.NeedsReviewAt != nil {
				s := pair.Row.NeedsReviewAt.UTC().Format(rfc3339Millis)
				needs = &s
			}
			ls = append(ls, conceptState{
				ConceptID:     pair.Row.ConceptID.String(),
				ConceptName:   pair.Row.ConceptName,
				Mastery:       pair.Row.MasteryEffective,
				AttemptCount:  pair.Row.AttemptCount,
				LastSeenAt:    lastSeen,
				NeedsReviewAt: needs,
			})
			states[pair.UserID.String()] = ls
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"states": states})
	}
}

const rfc3339Millis = "2006-01-02T15:04:05.000Z07:00"

func (d Deps) handleLearnerConceptsList() http.HandlerFunc {
	type conceptState struct {
		ConceptID        string  `json:"conceptId"`
		ConceptName      string  `json:"conceptName"`
		Mastery          float64 `json:"mastery"`
		AttemptCount     int32   `json:"attemptCount"`
		LastSeenAt       *string `json:"lastSeenAt,omitempty"`
		NeedsReviewAt    *string `json:"needsReviewAt,omitempty"`
	}
	type resp struct {
		Concepts []conceptState `json:"concepts"`
	}
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
		target, err := uuid.Parse(chi.URLParam(r, "user_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid learner id.")
			return
		}
		can, err := assertCanReadLearnerState(r.Context(), d.Pool, viewer, target)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !can {
			writeLearnerAccessDenied(w)
			return
		}
		rows, err := learnermodel.ListConceptStatesForUser(r.Context(), d.Pool, target, nil)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load concepts.")
			return
		}
		out := make([]conceptState, 0, len(rows))
		for _, row := range rows {
			var lastSeen, needs *string
			if row.LastSeenAt != nil {
				s := row.LastSeenAt.UTC().Format(rfc3339Millis)
				lastSeen = &s
			}
			if row.NeedsReviewAt != nil {
				s := row.NeedsReviewAt.UTC().Format(rfc3339Millis)
				needs = &s
			}
			out = append(out, conceptState{
				ConceptID:     row.ConceptID.String(),
				ConceptName:   row.ConceptName,
				Mastery:       row.MasteryEffective,
				AttemptCount:  row.AttemptCount,
				LastSeenAt:    lastSeen,
				NeedsReviewAt: needs,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Concepts: out})
	}
}

func (d Deps) handleLearnerConceptOne() http.HandlerFunc {
	type conceptState struct {
		ConceptID        string  `json:"conceptId"`
		ConceptName      string  `json:"conceptName"`
		Mastery          float64 `json:"mastery"`
		AttemptCount     int32   `json:"attemptCount"`
		LastSeenAt       *string `json:"lastSeenAt,omitempty"`
		NeedsReviewAt    *string `json:"needsReviewAt,omitempty"`
	}
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
		target, err := uuid.Parse(chi.URLParam(r, "user_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid learner id.")
			return
		}
		cid, err := uuid.Parse(chi.URLParam(r, "concept_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid concept id.")
			return
		}
		can, err := assertCanReadLearnerState(r.Context(), d.Pool, viewer, target)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !can {
			writeLearnerAccessDenied(w)
			return
		}
		row, err := learnermodel.GetConceptStateForUser(r.Context(), d.Pool, target, cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load concept state.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var lastSeen, needs *string
		if row.LastSeenAt != nil {
			s := row.LastSeenAt.UTC().Format(rfc3339Millis)
			lastSeen = &s
		}
		if row.NeedsReviewAt != nil {
			s := row.NeedsReviewAt.UTC().Format(rfc3339Millis)
			needs = &s
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(conceptState{
			ConceptID:     row.ConceptID.String(),
			ConceptName:   row.ConceptName,
			Mastery:       row.MasteryEffective,
			AttemptCount:  row.AttemptCount,
			LastSeenAt:    lastSeen,
			NeedsReviewAt: needs,
		})
	}
}

func (d Deps) handleLearnerConceptTheta() http.HandlerFunc {
	type resp struct {
		Theta          *float64 `json:"theta,omitempty"`
		ThetaSE        *float64 `json:"thetaSe,omitempty"`
		LastUpdatedAt  *string  `json:"lastUpdatedAt,omitempty"`
	}
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
		target, err := uuid.Parse(chi.URLParam(r, "user_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid learner id.")
			return
		}
		cid, err := uuid.Parse(chi.URLParam(r, "concept_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid concept id.")
			return
		}
		can, err := assertCanReadLearnerState(r.Context(), d.Pool, viewer, target)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !can {
			writeLearnerAccessDenied(w)
			return
		}
		meta, err := learnermodel.GetLearnerThetaMeta(r.Context(), d.Pool, target, cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load theta.")
			return
		}
		out := resp{}
		if meta != nil {
			out.Theta = meta.Theta
			out.ThetaSE = meta.ThetaSE
			if meta.LastUpdated != nil {
				s := meta.LastUpdated.UTC().Format(rfc3339Millis)
				out.LastUpdatedAt = &s
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (d Deps) handleLearnerMisconceptionSummary() http.HandlerFunc {
	type row struct {
		MisconceptionID string `json:"misconceptionId"`
		Name            string `json:"name"`
		TriggerCount    int64  `json:"triggerCount"`
	}
	type resp struct {
		Recurring      []row `json:"recurring"`
		AllTimeCount   int64 `json:"allTimeCount"`
	}
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
		target, err := uuid.Parse(chi.URLParam(r, "user_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid learner id.")
			return
		}
		can, err := assertCanReadLearnerState(r.Context(), d.Pool, viewer, target)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !can {
			writeLearnerAccessDenied(w)
			return
		}
		cc := strings.TrimSpace(r.URL.Query().Get("courseCode"))
		if cc == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "courseCode is required.")
			return
		}
		okAccess, err := enrollment.UserHasAccess(r.Context(), d.Pool, cc, target)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !okAccess {
			writeLearnerAccessDenied(w)
			return
		}
		courseID, err := course.GetIDByCourseCode(r.Context(), d.Pool, cc)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Database error.")
			return
		}
		if courseID == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		rec, err := misconceptions.ListRecurringForUserCourse(r.Context(), d.Pool, target, *courseID, 3)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load misconceptions.")
			return
		}
		allN, err := misconceptions.CountAllEventsForUserCourse(r.Context(), d.Pool, target, *courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load misconceptions.")
			return
		}
		rows := make([]row, 0, len(rec))
		for _, m := range rec {
			rows = append(rows, row{MisconceptionID: m.MisconceptionID.String(), Name: m.Name, TriggerCount: m.TriggerCount})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Recurring: rows, AllTimeCount: allN})
	}
}

func (d Deps) handleLearnerReviewSubmit() http.HandlerFunc {
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
		target, err := uuid.Parse(chi.URLParam(r, "user_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid learner id.")
			return
		}
		var body srssvc.SubmitReviewBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		out, err := srssvc.SubmitReview(r.Context(), d.Pool, viewer, target, body)
		if err != nil {
			var se *srssvc.ErrSubmitReview
			if errors.As(err, &se) {
				apierr.WriteJSON(w, se.Code, se.APICode, se.Msg)
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to submit review.")
			return
		}
		type resp struct {
			NextReviewAt string  `json:"nextReviewAt"`
			IntervalDays float64 `json:"intervalDays"`
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{
			NextReviewAt: out.NextReviewAt.UTC().Format(time.RFC3339),
			IntervalDays: out.IntervalDays,
		})
	}
}
