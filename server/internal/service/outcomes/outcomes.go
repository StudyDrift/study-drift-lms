package outcomes

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/models/courseoutcomesapi"
	"github.com/lextures/lextures/server/internal/repos/coursemodulequizzes"
	"github.com/lextures/lextures/server/internal/repos/courseoutcomes"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
)

// Error kinds returned to HTTP handlers (map to 4xx in the handler layer).
type ErrorKind int

const (
	ErrorKindInvalidInput ErrorKind = iota
	ErrorKindNotFound
)

type ServiceError struct {
	Kind    ErrorKind
	Message string
}

func (e *ServiceError) Error() string { return e.Message }

func errInvalidInput(msg string) error {
	return &ServiceError{Kind: ErrorKindInvalidInput, Message: msg}
}
func errNotFound(msg string) error { return &ServiceError{Kind: ErrorKindNotFound, Message: msg} }

// ValidateOutcomeLinkLevels enforces the allowed measurement/intensity sets (see migration 074).
func ValidateOutcomeLinkLevels(measurement *string, intensity *string) (string, string, error) {
	mRaw := ""
	if measurement != nil {
		mRaw = *measurement
	}
	mRaw = strings.TrimSpace(mRaw)
	if mRaw == "" {
		mRaw = "formative"
	}

	iRaw := ""
	if intensity != nil {
		iRaw = *intensity
	}
	iRaw = strings.TrimSpace(iRaw)
	if iRaw == "" {
		iRaw = "medium"
	}

	if !containsString(courseoutcomes.MeasurementLevels, mRaw) {
		return "", "", errInvalidInput(fmt.Sprintf(
			"measurementLevel must be one of: %s.",
			strings.Join(courseoutcomes.MeasurementLevels, ", "),
		))
	}
	if !containsString(courseoutcomes.IntensityLevels, iRaw) {
		return "", "", errInvalidInput(fmt.Sprintf(
			"intensityLevel must be one of: %s.",
			strings.Join(courseoutcomes.IntensityLevels, ", "),
		))
	}
	return mRaw, iRaw, nil
}

// RollupAvgForOutcomeLinks is the deduped average described in `server/src/services/outcomes.rs`.
func RollupAvgForOutcomeLinks(links []courseoutcomesapi.CourseOutcomeLinkAPI) *float32 {
	type key struct {
		StructureItemID uuid.UUID
		TargetKind      string
		QuizQuestionID  string
		SubOutcomeID    *uuid.UUID
	}
	by := map[key]float32{}
	for _, link := range links {
		prog, err := courseoutcomes.DecodeProgressFromMapJSON(link.Progress)
		if err != nil {
			continue
		}
		if prog.AvgScorePercent == nil {
			continue
		}
		k := key{
			StructureItemID: link.StructureItemID,
			TargetKind:      link.TargetKind,
			QuizQuestionID:  link.QuizQuestionID,
			SubOutcomeID:    link.SubOutcomeID,
		}
		by[k] = *prog.AvgScorePercent
	}
	if len(by) == 0 {
		return nil
	}
	var sum float32
	for _, v := range by {
		sum += v
	}
	avg := sum / float32(len(by))
	return &avg
}

// AddOutcomeLink implements `server/src/services/outcomes.rs::add_outcome_link` (DB-backed).
func AddOutcomeLink(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID uuid.UUID,
	courseCode string,
	outcomeID uuid.UUID,
	req *courseoutcomesapi.PostCourseOutcomeLinkRequest,
) (*courseoutcomesapi.CourseOutcomeLinkAPI, error) {
	if req == nil {
		return nil, errInvalidInput("Request body is required.")
	}

	outcomes, err := courseoutcomes.ListOutcomes(ctx, pool, courseID)
	if err != nil {
		return nil, err
	}
	if !outcomeIDInList(outcomes, outcomeID) {
		return nil, errNotFound("Not found.")
	}

	kind := strings.TrimSpace(req.TargetKind)
	if kind != "assignment" && kind != "quiz" && kind != "quiz_question" {
		return nil, errInvalidInput("targetKind must be assignment, quiz, or quiz_question.")
	}

	item, err := coursestructure.GetItemRow(ctx, pool, courseID, req.StructureItemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, errInvalidInput("That module item is not part of this course.")
	}

	qid := ""
	if req.QuizQuestionID != nil {
		qid = strings.TrimSpace(*req.QuizQuestionID)
	}

	qidStore := ""
	if kind == "quiz_question" {
		if qid == "" {
			return nil, errInvalidInput("quizQuestionId is required when targetKind is quiz_question.")
		}
		quizRow, err := coursemodulequizzes.GetForCourseItem(ctx, pool, courseID, req.StructureItemID)
		if err != nil {
			return nil, err
		}
		if quizRow == nil {
			return nil, errInvalidInput("Quiz not found for that item.")
		}
		if !quizContainsQuestionID(quizRow, qid) {
			return nil, errInvalidInput("That quiz does not contain a question with the given id.")
		}
		qidStore = qid
	}

	expectedKind := ""
	switch kind {
	case "assignment":
		expectedKind = "assignment"
	case "quiz", "quiz_question":
		expectedKind = "quiz"
	default:
		expectedKind = ""
	}
	if item.Kind != expectedKind {
		return nil, errInvalidInput("The module item type does not match targetKind.")
	}

	measurement, intensity, err := ValidateOutcomeLinkLevels(req.MeasurementLevel, req.IntensityLevel)
	if err != nil {
		return nil, err
	}

	if req.SubOutcomeID != nil {
		ok, err := courseoutcomes.SubOutcomeOwnedByOutcomeInCourse(ctx, pool, courseID, outcomeID, *req.SubOutcomeID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errInvalidInput("subOutcomeId must belong to this outcome in the same course.")
		}
		if kind == "quiz_question" {
			return nil, errInvalidInput("subOutcomeId is only supported for whole-quiz or assignment evidence links.")
		}
	}

	inserted, err := courseoutcomes.InsertLink(
		ctx,
		pool,
		outcomeID,
		req.SubOutcomeID,
		req.StructureItemID,
		kind,
		qidStore,
		measurement,
		intensity,
	)
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe != nil && pe.Code == "23505" {
			return nil, errInvalidInput(
				"This outcome already maps that item with the same measurement and intensity levels. Change the levels or remove the existing mapping first.",
			)
		}
		if strings.Contains(err.Error(), "duplicate outcome link") {
			return nil, errInvalidInput(
				"This outcome already maps that item with the same measurement and intensity levels. Change the levels or remove the existing mapping first.",
			)
		}
		return nil, err
	}

	students, err := enrollment.ListStudentUsersForCourseCode(ctx, pool, courseCode)
	if err != nil {
		return nil, err
	}
	enrolled := int32(len(students))

	var prog courseoutcomes.OutcomeLinkProgress
	switch kind {
	case "quiz_question":
		prog, err = courseoutcomes.ProgressForQuizQuestion(ctx, pool, courseID, req.StructureItemID, qidStore, enrolled)
		if err != nil {
			return nil, err
		}
	case "assignment", "quiz":
		prog, err = courseoutcomes.ProgressForGradedItem(ctx, pool, courseID, req.StructureItemID, item.Kind, enrolled)
		if err != nil {
			return nil, err
		}
	default:
		prog = courseoutcomes.OutcomeLinkProgress{
			GradedLearners:   0,
			EnrolledLearners: enrolled,
		}
	}

	return &courseoutcomesapi.CourseOutcomeLinkAPI{
		ID:               inserted.ID,
		SubOutcomeID:     inserted.SubOutcomeID,
		StructureItemID:  inserted.StructureItemID,
		TargetKind:       inserted.TargetKind,
		QuizQuestionID:   inserted.QuizQuestionID,
		MeasurementLevel: inserted.MeasurementLevel,
		IntensityLevel:   inserted.IntensityLevel,
		ItemTitle:        item.Title,
		ItemKind:         item.Kind,
		Progress:         courseoutcomes.ProgressToMapJSON(prog),
	}, nil
}

func outcomeIDInList(rows []courseoutcomes.LearningOutcomeRow, id uuid.UUID) bool {
	for i := range rows {
		if rows[i].ID == id {
			return true
		}
	}
	return false
}

func containsString(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}

func quizContainsQuestionID(q *coursemodulequizzes.QuizRow, id string) bool {
	if q == nil {
		return false
	}
	for i := range q.Questions {
		if q.Questions[i].ID == id {
			return true
		}
	}
	return false
}
