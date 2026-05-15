package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/courseroles"
	"github.com/lextures/lextures/server/internal/models/courseoutcomesapi"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/courseoutcomes"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	outcomessvc "github.com/lextures/lextures/server/internal/service/outcomes"
)

type courseOutcomesListResponse struct {
	EnrolledLearners int                `json:"enrolledLearners"`
	Outcomes         []courseOutcomeAPI `json:"outcomes"`
}

type courseOutcomeAPI struct {
	ID                    string                 `json:"id"`
	Title                 string                 `json:"title"`
	Description           string                 `json:"description"`
	SortOrder             int                    `json:"sortOrder"`
	RollupAvgScorePercent *float64               `json:"rollupAvgScorePercent"`
	Links                 []courseOutcomeLinkAPI `json:"links"`
}

type courseOutcomeLinkAPI struct {
	ID               string                    `json:"id"`
	SubOutcomeID     *string                   `json:"subOutcomeId,omitempty"`
	StructureItemID  string                    `json:"structureItemId"`
	TargetKind       string                    `json:"targetKind"`
	QuizQuestionID   string                    `json:"quizQuestionId"`
	MeasurementLevel string                    `json:"measurementLevel"`
	IntensityLevel   string                    `json:"intensityLevel"`
	ItemTitle        string                    `json:"itemTitle"`
	ItemKind         string                    `json:"itemKind"`
	Progress         courseOutcomeLinkProgress `json:"progress"`
}

type courseOutcomeLinkProgress struct {
	AvgScorePercent  *float64 `json:"avgScorePercent"`
	GradedLearners   int      `json:"gradedLearners"`
	EnrolledLearners int      `json:"enrolledLearners"`
}

type courseOutcomeSubOutcomeAPI struct {
	ID          string `json:"id"`
	OutcomeID   string `json:"outcomeId"`
	Title       string `json:"title"`
	Description string `json:"description"`
	SortOrder   int    `json:"sortOrder"`
}

func learningOutcomeRowToAPI(row courseoutcomes.LearningOutcomeRow) courseOutcomeAPI {
	return courseOutcomeAPI{
		ID:                    row.ID.String(),
		Title:                 row.Title,
		Description:           row.Description,
		SortOrder:             int(row.SortOrder),
		RollupAvgScorePercent: nil,
		Links:                 []courseOutcomeLinkAPI{},
	}
}

func outcomeLinkProgress(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, enrolled int32, link courseoutcomes.OutcomeLinkWithItemRow) (courseoutcomes.OutcomeLinkProgress, error) {
	switch link.TargetKind {
	case "quiz_question":
		qid := strings.TrimSpace(link.QuizQuestionID)
		return courseoutcomes.ProgressForQuizQuestion(ctx, pool, courseID, link.StructureItemID, qid, enrolled)
	case "quiz", "assignment":
		return courseoutcomes.ProgressForGradedItem(ctx, pool, courseID, link.StructureItemID, link.ItemKind, enrolled)
	default:
		return courseoutcomes.OutcomeLinkProgress{
			GradedLearners:   0,
			EnrolledLearners: enrolled,
		}, nil
	}
}

func courseOutcomeLinkHTTP(link courseoutcomes.OutcomeLinkWithItemRow, prog courseoutcomes.OutcomeLinkProgress) courseOutcomeLinkAPI {
	var sub *string
	if link.SubOutcomeID != nil {
		s := link.SubOutcomeID.String()
		sub = &s
	}
	var avg *float64
	if prog.AvgScorePercent != nil {
		v := float64(*prog.AvgScorePercent)
		avg = &v
	}
	return courseOutcomeLinkAPI{
		ID:               link.ID.String(),
		SubOutcomeID:     sub,
		StructureItemID:  link.StructureItemID.String(),
		TargetKind:       link.TargetKind,
		QuizQuestionID:   link.QuizQuestionID,
		MeasurementLevel: link.MeasurementLevel,
		IntensityLevel:   link.IntensityLevel,
		ItemTitle:        link.ItemTitle,
		ItemKind:         link.ItemKind,
		Progress: courseOutcomeLinkProgress{
			AvgScorePercent:  avg,
			GradedLearners:   int(prog.GradedLearners),
			EnrolledLearners: int(prog.EnrolledLearners),
		},
	}
}

func courseOutcomeLinkModel(link courseoutcomes.OutcomeLinkWithItemRow, prog courseoutcomes.OutcomeLinkProgress) courseoutcomesapi.CourseOutcomeLinkAPI {
	return courseoutcomesapi.CourseOutcomeLinkAPI{
		ID:               link.ID,
		SubOutcomeID:     link.SubOutcomeID,
		StructureItemID:  link.StructureItemID,
		TargetKind:       link.TargetKind,
		QuizQuestionID:   link.QuizQuestionID,
		MeasurementLevel: link.MeasurementLevel,
		IntensityLevel:   link.IntensityLevel,
		ItemTitle:        link.ItemTitle,
		ItemKind:         link.ItemKind,
		Progress:         courseoutcomes.ProgressToMapJSON(prog),
	}
}

func buildCourseOutcomeAPI(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID uuid.UUID,
	row courseoutcomes.LearningOutcomeRow,
	links []courseoutcomes.OutcomeLinkWithItemRow,
	enrolled int32,
) (courseOutcomeAPI, error) {
	modelLinks := make([]courseoutcomesapi.CourseOutcomeLinkAPI, 0, len(links))
	httpLinks := make([]courseOutcomeLinkAPI, 0, len(links))
	for i := range links {
		prog, err := outcomeLinkProgress(ctx, pool, courseID, enrolled, links[i])
		if err != nil {
			return courseOutcomeAPI{}, err
		}
		modelLinks = append(modelLinks, courseOutcomeLinkModel(links[i], prog))
		httpLinks = append(httpLinks, courseOutcomeLinkHTTP(links[i], prog))
	}
	api := learningOutcomeRowToAPI(row)
	api.Links = httpLinks
	if rollup := outcomessvc.RollupAvgForOutcomeLinks(modelLinks); rollup != nil {
		v := float64(*rollup)
		api.RollupAvgScorePercent = &v
	}
	return api, nil
}

func groupOutcomeLinksByOutcome(links []courseoutcomes.OutcomeLinkWithItemRow) map[uuid.UUID][]courseoutcomes.OutcomeLinkWithItemRow {
	by := make(map[uuid.UUID][]courseoutcomes.OutcomeLinkWithItemRow)
	for i := range links {
		id := links[i].OutcomeID
		by[id] = append(by[id], links[i])
	}
	return by
}

func outcomeSubOutcomeRowToAPI(row courseoutcomes.OutcomeSubOutcomeRow) courseOutcomeSubOutcomeAPI {
	return courseOutcomeSubOutcomeAPI{
		ID:          row.ID.String(),
		OutcomeID:   row.OutcomeID.String(),
		Title:       row.Title,
		Description: row.Description,
		SortOrder:   int(row.SortOrder),
	}
}

func parseCourseOutcomePatchInput(raw map[string]json.RawMessage) (courseoutcomes.UpdateOutcomeInput, error) {
	var in courseoutcomes.UpdateOutcomeInput
	if v, ok := raw["title"]; ok {
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return in, err
		}
		t := strings.TrimSpace(s)
		if t == "" {
			return in, errOutcomePatchEmptyTitle{}
		}
		in.Title = &t
	}
	if v, ok := raw["description"]; ok {
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return in, err
		}
		in.Description = &s
	}
	if v, ok := raw["moduleStructureItemId"]; ok {
		s := strings.TrimSpace(string(v))
		if s == "null" {
			var nilModule *uuid.UUID
			in.ModuleStructureItemID = &nilModule
		} else {
			var sid string
			if err := json.Unmarshal(v, &sid); err != nil {
				return in, err
			}
			sid = strings.TrimSpace(sid)
			if sid == "" {
				return in, errOutcomePatchInvalidModuleID{}
			}
			id, err := uuid.Parse(sid)
			if err != nil {
				return in, errOutcomePatchInvalidModuleID{}
			}
			pid := id
			pp := &pid
			in.ModuleStructureItemID = &pp
		}
	}
	return in, nil
}

type errOutcomePatchEmptyTitle struct{}

func (errOutcomePatchEmptyTitle) Error() string { return "title cannot be empty" }

type errOutcomePatchInvalidModuleID struct{}

func (errOutcomePatchInvalidModuleID) Error() string { return "invalid moduleStructureItemId" }

// handleCourseOutcomePatch is PATCH /api/v1/courses/{course_code}/outcomes/{outcome_id}.
func (d Deps) handleCourseOutcomePatch() http.HandlerFunc {
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
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit outcomes.")
			return
		}

		outcomeID, err := uuid.Parse(chi.URLParam(r, "outcome_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid outcome id.")
			return
		}

		var raw map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if len(raw) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Provide at least one field to update.")
			return
		}

		in, err := parseCourseOutcomePatchInput(raw)
		if err != nil {
			switch err.(type) {
			case errOutcomePatchEmptyTitle:
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title cannot be empty.")
			case errOutcomePatchInvalidModuleID:
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid moduleStructureItemId.")
			default:
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid patch payload.")
			}
			return
		}

		ctx := r.Context()
		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		updated, err := courseoutcomes.UpdateOutcome(ctx, d.Pool, *cid, outcomeID, in)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update outcome.")
			return
		}
		if updated == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Outcome not found.")
			return
		}

		students, err := enrollment.ListStudentUsersForCourseCode(ctx, d.Pool, courseCode, nil)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollments.")
			return
		}
		enrolled := int32(len(students))

		linkRows, err := courseoutcomes.ListLinksForOutcome(ctx, d.Pool, *cid, outcomeID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load outcome links.")
			return
		}

		out, err := buildCourseOutcomeAPI(ctx, d.Pool, *cid, *updated, linkRows, enrolled)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to build outcome response.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleCourseOutcomesPost is POST /api/v1/courses/{course_code}/outcomes.
func (d Deps) handleCourseOutcomesPost() http.HandlerFunc {
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
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit outcomes.")
			return
		}

		var body struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		title := strings.TrimSpace(body.Title)
		if title == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
			return
		}
		desc := strings.TrimSpace(body.Description)

		ctx := r.Context()
		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		row, err := courseoutcomes.InsertOutcome(ctx, d.Pool, *cid, title, desc)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create outcome.")
			return
		}

		out := learningOutcomeRowToAPI(*row)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleCourseOutcomesList is GET /api/v1/courses/{course_code}/outcomes.
func (d Deps) handleCourseOutcomesList() http.HandlerFunc {
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
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to view outcomes.")
			return
		}

		ctx := r.Context()
		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		rows, err := courseoutcomes.ListOutcomes(ctx, d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load outcomes.")
			return
		}

		students, err := enrollment.ListStudentUsersForCourseCode(ctx, d.Pool, courseCode, nil)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollments.")
			return
		}
		enrolled := int32(len(students))

		allLinks, err := courseoutcomes.ListLinksForCourse(ctx, d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load outcome links.")
			return
		}
		byOutcome := groupOutcomeLinksByOutcome(allLinks)

		outcomes := make([]courseOutcomeAPI, 0, len(rows))
		for i := range rows {
			linksForO := byOutcome[rows[i].ID]
			apiO, err := buildCourseOutcomeAPI(ctx, d.Pool, *cid, rows[i], linksForO, enrolled)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to build outcomes response.")
				return
			}
			outcomes = append(outcomes, apiO)
		}

		out := courseOutcomesListResponse{
			EnrolledLearners: len(students),
			Outcomes:         outcomes,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleCourseOutcomeSubOutcomesPost is POST /api/v1/courses/{course_code}/outcomes/{outcome_id}/sub-outcomes.
func (d Deps) handleCourseOutcomeSubOutcomesPost() http.HandlerFunc {
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
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit outcomes.")
			return
		}

		outcomeID, err := uuid.Parse(chi.URLParam(r, "outcome_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid outcome id.")
			return
		}

		var body struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		title := strings.TrimSpace(body.Title)
		if title == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
			return
		}
		desc := strings.TrimSpace(body.Description)

		ctx := r.Context()
		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		row, err := courseoutcomes.InsertSubOutcome(ctx, d.Pool, *cid, outcomeID, title, desc)
		if err != nil {
			if errors.Is(err, courseoutcomes.ErrLearningOutcomeNotInCourse) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Outcome not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create sub-outcome.")
			return
		}

		out := outcomeSubOutcomeRowToAPI(*row)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleCourseOutcomeLinksPost is POST /api/v1/courses/{course_code}/outcomes/{outcome_id}/links.
func (d Deps) handleCourseOutcomeLinksPost() http.HandlerFunc {
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
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit outcomes.")
			return
		}

		outcomeID, err := uuid.Parse(chi.URLParam(r, "outcome_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid outcome id.")
			return
		}

		var req courseoutcomesapi.PostCourseOutcomeLinkRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if req.StructureItemID == uuid.Nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "structureItemId is required.")
			return
		}

		ctx := r.Context()
		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}

		apiLink, err := outcomessvc.AddOutcomeLink(ctx, d.Pool, *cid, courseCode, outcomeID, &req)
		if err != nil {
			var se *outcomessvc.ServiceError
			if errors.As(err, &se) {
				switch se.Kind {
				case outcomessvc.ErrorKindInvalidInput:
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, se.Message)
				case outcomessvc.ErrorKindNotFound:
					apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, se.Message)
				default:
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, se.Message)
				}
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create outcome link.")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(apiLink)
	}
}

// handleCourseOutcomeDelete is DELETE /api/v1/courses/{course_code}/outcomes/{outcome_id}.
func (d Deps) handleCourseOutcomeDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit outcomes.")
			return
		}
		outcomeID, err := uuid.Parse(chi.URLParam(r, "outcome_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid outcome id.")
			return
		}
		ctx := r.Context()
		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		deleted, err := courseoutcomes.DeleteOutcome(ctx, d.Pool, *cid, outcomeID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete outcome.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Outcome not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleCourseOutcomeLinkDelete is DELETE /api/v1/courses/{course_code}/outcomes/{outcome_id}/links/{link_id}.
func (d Deps) handleCourseOutcomeLinkDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit outcomes.")
			return
		}
		outcomeID, err := uuid.Parse(chi.URLParam(r, "outcome_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid outcome id.")
			return
		}
		linkID, err := uuid.Parse(chi.URLParam(r, "link_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid link id.")
			return
		}
		ctx := r.Context()
		cid, err := course.GetIDByCourseCode(ctx, d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		deleted, err := courseoutcomes.DeleteLink(ctx, d.Pool, *cid, outcomeID, linkID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete outcome link.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Link not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
