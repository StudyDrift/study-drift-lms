package courseoutcomes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	MeasurementLevels = []string{"diagnostic", "formative", "summative", "performance"}
	IntensityLevels   = []string{"low", "medium", "high"}

	// ErrLearningOutcomeNotInCourse is returned by InsertSubOutcome when outcome_id is missing or not in course_id.
	ErrLearningOutcomeNotInCourse = errors.New("learning outcome not found for course")
)

type LearningOutcomeRow struct {
	ID                    uuid.UUID
	CourseID              uuid.UUID
	Title                 string
	Description           string
	SortOrder             int32
	ModuleStructureItemID *uuid.UUID
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

type OutcomeSubOutcomeRow struct {
	ID          uuid.UUID
	OutcomeID   uuid.UUID
	Title       string
	Description string
	SortOrder   int32
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type OutcomeLinkRow struct {
	ID               uuid.UUID
	OutcomeID        uuid.UUID
	SubOutcomeID     *uuid.UUID
	StructureItemID  uuid.UUID
	TargetKind       string
	QuizQuestionID   string
	MeasurementLevel string
	IntensityLevel   string
	CreatedAt        time.Time
}

type OutcomeLinkWithItemRow struct {
	OutcomeLinkRow
	ItemTitle string
	ItemKind  string
}

type OutcomeLinkProgress struct {
	AvgScorePercent  *float32
	GradedLearners   int32
	EnrolledLearners int32
}

func ListOutcomes(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]LearningOutcomeRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, course_id, title, description, sort_order, module_structure_item_id, created_at, updated_at
FROM course.course_learning_outcomes
WHERE course_id = $1
ORDER BY sort_order ASC, created_at ASC
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LearningOutcomeRow
	for rows.Next() {
		var r LearningOutcomeRow
		if err := rows.Scan(&r.ID, &r.CourseID, &r.Title, &r.Description, &r.SortOrder, &r.ModuleStructureItemID, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func ListLinksForOutcome(ctx context.Context, pool *pgxpool.Pool, courseID, outcomeID uuid.UUID) ([]OutcomeLinkWithItemRow, error) {
	rows, err := pool.Query(ctx, `
SELECT l.id, l.outcome_id, l.sub_outcome_id, l.structure_item_id, l.target_kind, l.quiz_question_id, l.measurement_level, l.intensity_level, l.created_at, s.title AS item_title, s.kind AS item_kind
FROM course.course_outcome_links l
INNER JOIN course.course_learning_outcomes o ON o.id = l.outcome_id
INNER JOIN course.course_structure_items s ON s.id = l.structure_item_id
WHERE o.course_id = $1 AND l.outcome_id = $2
ORDER BY l.created_at ASC
`, courseID, outcomeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OutcomeLinkWithItemRow
	for rows.Next() {
		var r OutcomeLinkWithItemRow
		if err := rows.Scan(&r.ID, &r.OutcomeID, &r.SubOutcomeID, &r.StructureItemID, &r.TargetKind, &r.QuizQuestionID, &r.MeasurementLevel, &r.IntensityLevel, &r.CreatedAt, &r.ItemTitle, &r.ItemKind); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListLinksForCourse returns all links for a course, ordered for stable rollups.
func ListLinksForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]OutcomeLinkWithItemRow, error) {
	rows, err := pool.Query(ctx, `
SELECT
    l.id,
    l.outcome_id,
    l.sub_outcome_id,
    l.structure_item_id,
    l.target_kind,
    l.quiz_question_id,
    l.measurement_level,
    l.intensity_level,
    l.created_at,
    s.title AS item_title,
    s.kind AS item_kind
FROM course.course_outcome_links l
INNER JOIN course.course_learning_outcomes o ON o.id = l.outcome_id
INNER JOIN course.course_structure_items s ON s.id = l.structure_item_id
WHERE o.course_id = $1
ORDER BY l.outcome_id, l.created_at ASC
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OutcomeLinkWithItemRow
	for rows.Next() {
		var r OutcomeLinkWithItemRow
		if err := rows.Scan(&r.ID, &r.OutcomeID, &r.SubOutcomeID, &r.StructureItemID, &r.TargetKind, &r.QuizQuestionID, &r.MeasurementLevel, &r.IntensityLevel, &r.CreatedAt, &r.ItemTitle, &r.ItemKind); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type UpdateOutcomeInput struct {
	Title                 *string
	Description           *string
	ModuleStructureItemID **uuid.UUID
}

// UpdateOutcome updates a learning outcome row, mirroring `server/src/repos/course_outcomes::update_outcome`.
func UpdateOutcome(ctx context.Context, pool *pgxpool.Pool, courseID, outcomeID uuid.UUID, in UpdateOutcomeInput) (*LearningOutcomeRow, error) {
	var cur LearningOutcomeRow
	err := pool.QueryRow(ctx, `
SELECT id, course_id, title, description, sort_order, module_structure_item_id, created_at, updated_at
FROM course.course_learning_outcomes
WHERE id = $1 AND course_id = $2
`, outcomeID, courseID).Scan(
		&cur.ID, &cur.CourseID, &cur.Title, &cur.Description, &cur.SortOrder, &cur.ModuleStructureItemID, &cur.CreatedAt, &cur.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	title := cur.Title
	if in.Title != nil {
		t := *in.Title
		t = strings.TrimSpace(t)
		if t != "" {
			title = t
		}
	}

	desc := cur.Description
	if in.Description != nil {
		desc = *in.Description
	}

	moduleID := cur.ModuleStructureItemID
	if in.ModuleStructureItemID != nil {
		moduleID = *in.ModuleStructureItemID
	}

	var r LearningOutcomeRow
	err = pool.QueryRow(ctx, `
UPDATE course.course_learning_outcomes
SET title = $3, description = $4, module_structure_item_id = $5, updated_at = NOW()
WHERE id = $1 AND course_id = $2
RETURNING id, course_id, title, description, sort_order, module_structure_item_id, created_at, updated_at
`, outcomeID, courseID, title, desc, moduleID).Scan(
		&r.ID, &r.CourseID, &r.Title, &r.Description, &r.SortOrder, &r.ModuleStructureItemID, &r.CreatedAt, &r.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func InsertOutcome(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, title, description string) (*LearningOutcomeRow, error) {
	var nextSort int32
	if err := pool.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM course.course_learning_outcomes WHERE course_id = $1`, courseID).Scan(&nextSort); err != nil {
		return nil, err
	}
	var r LearningOutcomeRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.course_learning_outcomes (course_id, title, description, sort_order)
VALUES ($1, $2, $3, $4)
RETURNING id, course_id, title, description, sort_order, module_structure_item_id, created_at, updated_at
`, courseID, title, description, nextSort).Scan(&r.ID, &r.CourseID, &r.Title, &r.Description, &r.SortOrder, &r.ModuleStructureItemID, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func DeleteOutcome(ctx context.Context, pool *pgxpool.Pool, courseID, outcomeID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM course.course_learning_outcomes WHERE id = $1 AND course_id = $2`, outcomeID, courseID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func InsertLink(ctx context.Context, pool *pgxpool.Pool, outcomeID uuid.UUID, subOutcomeID *uuid.UUID, structureItemID uuid.UUID, targetKind, quizQuestionID, measurementLevel, intensityLevel string) (*OutcomeLinkRow, error) {
	var r OutcomeLinkRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.course_outcome_links (outcome_id, sub_outcome_id, structure_item_id, target_kind, quiz_question_id, measurement_level, intensity_level)
VALUES ($1,$2,$3,$4,$5,$6,$7)
RETURNING id, outcome_id, sub_outcome_id, structure_item_id, target_kind, quiz_question_id, measurement_level, intensity_level, created_at
`, outcomeID, subOutcomeID, structureItemID, targetKind, quizQuestionID, measurementLevel, intensityLevel).Scan(
		&r.ID, &r.OutcomeID, &r.SubOutcomeID, &r.StructureItemID, &r.TargetKind, &r.QuizQuestionID, &r.MeasurementLevel, &r.IntensityLevel, &r.CreatedAt,
	)
	if err != nil {
		// Uniqueness is enforced by partial unique indexes; map to a stable error for services.
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe != nil && pe.Code == "23505" {
			return nil, fmt.Errorf("courseoutcomes: duplicate outcome link: %w", err)
		}
		return nil, err
	}
	return &r, nil
}

func DeleteLink(ctx context.Context, pool *pgxpool.Pool, courseID, outcomeID, linkID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `
DELETE FROM course.course_outcome_links l
USING course.course_learning_outcomes o
WHERE l.id = $1 AND l.outcome_id = $2 AND l.outcome_id = o.id AND o.course_id = $3
`, linkID, outcomeID, courseID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func InsertSubOutcome(ctx context.Context, pool *pgxpool.Pool, courseID, outcomeID uuid.UUID, title, description string) (*OutcomeSubOutcomeRow, error) {
	var ok bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM course.course_learning_outcomes o WHERE o.id = $1 AND o.course_id = $2)`, outcomeID, courseID).Scan(&ok); err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrLearningOutcomeNotInCourse
	}
	var nextSort int32
	if err := pool.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM course.course_outcome_sub_outcomes WHERE outcome_id = $1`, outcomeID).Scan(&nextSort); err != nil {
		return nil, err
	}
	var r OutcomeSubOutcomeRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.course_outcome_sub_outcomes (outcome_id, title, description, sort_order)
VALUES ($1,$2,$3,$4)
RETURNING id, outcome_id, title, description, sort_order, created_at, updated_at
`, outcomeID, title, description, nextSort).Scan(&r.ID, &r.OutcomeID, &r.Title, &r.Description, &r.SortOrder, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func SubOutcomeOwnedByOutcomeInCourse(ctx context.Context, pool *pgxpool.Pool, courseID, outcomeID, subOutcomeID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(
	SELECT 1
	FROM course.course_outcome_sub_outcomes s
	INNER JOIN course.course_learning_outcomes o ON o.id = s.outcome_id
	WHERE s.id = $1 AND s.outcome_id = $2 AND o.course_id = $3
)
`, subOutcomeID, outcomeID, courseID).Scan(&ok)
	return ok, err
}

func assignmentPointsPossible(ctx context.Context, pool *pgxpool.Pool, itemID uuid.UUID) (float64, error) {
	var v *int32
	err := pool.QueryRow(ctx, `SELECT points_worth FROM course.module_assignments WHERE structure_item_id = $1`, itemID).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if v == nil || *v <= 0 {
		return 0, nil
	}
	return float64(*v), nil
}

func quizPointsPossible(ctx context.Context, pool *pgxpool.Pool, itemID uuid.UUID) (float64, error) {
	var v *int32
	err := pool.QueryRow(ctx, `SELECT points_worth FROM course.module_quizzes WHERE structure_item_id = $1`, itemID).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if v == nil || *v <= 0 {
		return 0, nil
	}
	return float64(*v), nil
}

// ProgressForGradedItem mirrors `server/src/repos/course_outcomes::progress_for_graded_item`.
func ProgressForGradedItem(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, itemKind string, enrolledLearners int32) (OutcomeLinkProgress, error) {
	var possible float64
	switch itemKind {
	case "assignment":
		p, err := assignmentPointsPossible(ctx, pool, itemID)
		if err != nil {
			return OutcomeLinkProgress{}, err
		}
		possible = p
	case "quiz":
		p, err := quizPointsPossible(ctx, pool, itemID)
		if err != nil {
			return OutcomeLinkProgress{}, err
		}
		possible = p
	default:
		possible = 0
	}

	rows, err := pool.Query(ctx, `
SELECT student_user_id, points_earned
FROM course.course_grades
WHERE course_id = $1 AND module_item_id = $2
`, courseID, itemID)
	if err != nil {
		return OutcomeLinkProgress{}, err
	}
	defer rows.Close()

	var graded int
	var sum float64
	for rows.Next() {
		var sid uuid.UUID
		var earned float64
		if err := rows.Scan(&sid, &earned); err != nil {
			return OutcomeLinkProgress{}, err
		}
		graded++
		if possible <= 0 {
			continue
		}
		pct := (earned / possible)
		if pct < 0 {
			pct = 0
		} else if pct > 1 {
			pct = 1
		}
		v := float64(pct * 100.0)
		if isFiniteF64(v) {
			sum += v
		}
	}
	if err := rows.Err(); err != nil {
		return OutcomeLinkProgress{}, err
	}

	if possible <= 0 || graded == 0 {
		g32 := int32(graded)
		return OutcomeLinkProgress{
			AvgScorePercent:  nil,
			GradedLearners:   g32,
			EnrolledLearners: enrolledLearners,
		}, nil
	}

	avg := float32(sum / float64(graded))
	return OutcomeLinkProgress{
		AvgScorePercent:  &avg,
		GradedLearners:   int32(graded),
		EnrolledLearners: enrolledLearners,
	}, nil
}

// ProgressForQuizQuestion mirrors `server/src/repos/course_outcomes::progress_for_quiz_question`.
func ProgressForQuizQuestion(ctx context.Context, pool *pgxpool.Pool, courseID, quizItemID uuid.UUID, questionID string, enrolledLearners int32) (OutcomeLinkProgress, error) {
	rows, err := pool.Query(ctx, `
WITH latest AS (
    SELECT DISTINCT ON (student_user_id)
        id
    FROM course.quiz_attempts
    WHERE course_id = $1
      AND structure_item_id = $2
      AND status = 'submitted'
    ORDER BY student_user_id, submitted_at DESC NULLS LAST, id DESC
)
SELECT
    CASE
        WHEN qr.max_points > 0::double precision
            THEN (COALESCE(qr.points_awarded, 0)::double precision / qr.max_points)
        ELSE NULL
    END AS ratio
FROM latest la
INNER JOIN course.quiz_responses qr ON qr.attempt_id = la.id
WHERE qr.question_id = $3
`, courseID, quizItemID, questionID)
	if err != nil {
		return OutcomeLinkProgress{}, err
	}
	defer rows.Close()

	var ratios []float64
	for rows.Next() {
		var ratio *float64
		if err := rows.Scan(&ratio); err != nil {
			return OutcomeLinkProgress{}, err
		}
		if ratio == nil {
			continue
		}
		if !isFiniteF64(*ratio) {
			continue
		}
		ratios = append(ratios, *ratio)
	}
	if err := rows.Err(); err != nil {
		return OutcomeLinkProgress{}, err
	}

	graded := len(ratios)
	if graded == 0 {
		return OutcomeLinkProgress{
			AvgScorePercent:  nil,
			GradedLearners:   0,
			EnrolledLearners: enrolledLearners,
		}, nil
	}

	var sum float64
	for _, r := range ratios {
		sum += r
	}
	avg := float32((sum / float64(graded)) * 100.0)
	return OutcomeLinkProgress{
		AvgScorePercent:  &avg,
		GradedLearners:   int32(graded),
		EnrolledLearners: enrolledLearners,
	}, nil
}

// ProgressToMapJSON converts the progress struct into the `any` JSON field used in API models.
func ProgressToMapJSON(p OutcomeLinkProgress) map[string]any {
	m := map[string]any{
		"avgScorePercent":  nil,
		"gradedLearners":   p.GradedLearners,
		"enrolledLearners": p.EnrolledLearners,
	}
	if p.AvgScorePercent != nil {
		// use float64 for JSON number stability
		v := float64(*p.AvgScorePercent)
		m["avgScorePercent"] = v
	}
	return m
}

// DecodeProgressFromMapJSON is a helper for server-side model bridges/tests.
func DecodeProgressFromMapJSON(v any) (OutcomeLinkProgress, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return OutcomeLinkProgress{}, err
	}
	var dto struct {
		AvgScorePercent  *float32 `json:"avgScorePercent"`
		GradedLearners   int32    `json:"gradedLearners"`
		EnrolledLearners int32    `json:"enrolledLearners"`
	}
	if err := json.Unmarshal(b, &dto); err != nil {
		return OutcomeLinkProgress{}, err
	}
	return OutcomeLinkProgress{
		AvgScorePercent:  dto.AvgScorePercent,
		GradedLearners:   dto.GradedLearners,
		EnrolledLearners: dto.EnrolledLearners,
	}, nil
}

func isFiniteF64(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
