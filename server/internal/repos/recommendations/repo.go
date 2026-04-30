package recommendations

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RecommendationOverrideRow struct {
	ID              uuid.UUID
	CourseID        uuid.UUID
	StructureItemID uuid.UUID
	OverrideType    string
	Surface         *string
	CreatedBy       uuid.UUID
	CreatedAt       time.Time
}

func ListOverridesForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]RecommendationOverrideRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, course_id, structure_item_id, override_type, surface, created_by, created_at
FROM course.course_recommendation_overrides
WHERE course_id = $1
ORDER BY created_at ASC
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RecommendationOverrideRow, 0)
	for rows.Next() {
		var r RecommendationOverrideRow
		if err := rows.Scan(&r.ID, &r.CourseID, &r.StructureItemID, &r.OverrideType, &r.Surface, &r.CreatedBy, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func CountPinsForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
SELECT COUNT(*)::int8
FROM course.course_recommendation_overrides
WHERE course_id = $1 AND override_type = 'pin'
`, courseID).Scan(&n)
	return n, err
}

func InsertOverride(ctx context.Context, pool *pgxpool.Pool, courseID, structureItemID uuid.UUID, overrideType string, surface *string, createdBy uuid.UUID) (*RecommendationOverrideRow, error) {
	var r RecommendationOverrideRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.course_recommendation_overrides (course_id, structure_item_id, override_type, surface, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, course_id, structure_item_id, override_type, surface, created_by, created_at
`, courseID, structureItemID, overrideType, surface, createdBy).Scan(
		&r.ID, &r.CourseID, &r.StructureItemID, &r.OverrideType, &r.Surface, &r.CreatedBy, &r.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func DeleteOverrideForCourse(ctx context.Context, pool *pgxpool.Pool, courseID, overrideID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `
DELETE FROM course.course_recommendation_overrides
WHERE id = $1 AND course_id = $2
`, overrideID, courseID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

type CachedRecommendations struct {
	Recommendations []json.RawMessage `json:"recommendations"`
	Degraded        bool              `json:"degraded"`
}

func GetCache(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID, surface string) (*CachedRecommendations, bool, error) {
	var payload json.RawMessage
	var expiresAt time.Time
	err := pool.QueryRow(ctx, `
SELECT recommendations, expires_at
FROM course.recommendation_cache
WHERE user_id = $1 AND course_id = $2 AND surface = $3
`, userID, courseID, surface).Scan(&payload, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var parsed CachedRecommendations
	if err := json.Unmarshal(payload, &parsed); err != nil {
		parsed = CachedRecommendations{}
	}
	expired := !expiresAt.After(time.Now().UTC())
	return &parsed, expired, nil
}

func UpsertCache(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID, surface string, payload *CachedRecommendations, ttl time.Duration) error {
	if payload == nil {
		payload = &CachedRecommendations{}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		raw = []byte(`{"recommendations":[],"degraded":false}`)
	}
	expiresAt := time.Now().UTC().Add(ttl)
	_, err = pool.Exec(ctx, `
INSERT INTO course.recommendation_cache (user_id, course_id, surface, recommendations, computed_at, expires_at)
VALUES ($1, $2, $3, $4, NOW(), $5)
ON CONFLICT (user_id, course_id, surface) DO UPDATE
SET recommendations = EXCLUDED.recommendations,
	computed_at = NOW(),
	expires_at = EXCLUDED.expires_at
`, userID, courseID, surface, raw, expiresAt)
	return err
}

func InsertEvent(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID, itemID *uuid.UUID, surface, eventType string, rank *int16) error {
	_, err := pool.Exec(ctx, `
INSERT INTO course.recommendation_events (user_id, course_id, item_id, surface, event_type, rank)
VALUES ($1, $2, $3, $4, $5, $6)
`, userID, courseID, itemID, surface, eventType, rank)
	return err
}

type ConceptQuizItemRow struct {
	ConceptID       uuid.UUID
	StructureItemID uuid.UUID
	Title           string
}

func ListConceptQuizStructureItems(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]ConceptQuizItemRow, error) {
	rows, err := pool.Query(ctx, `
SELECT DISTINCT cqt.concept_id, si.id AS structure_item_id, si.title
FROM course.concept_question_tags cqt
INNER JOIN course.questions qu ON qu.id = cqt.question_id AND qu.course_id = $1
INNER JOIN course.quiz_question_refs qqr ON qqr.structure_item_id IN (
	SELECT id FROM course.course_structure_items WHERE course_id = $1
)
AND (
	qqr.question_id = qu.id
	OR EXISTS (SELECT 1 FROM course.question_pool_members m WHERE m.pool_id = qqr.pool_id AND m.question_id = qu.id)
)
INNER JOIN course.course_structure_items si ON si.id = qqr.structure_item_id AND si.course_id = $1 AND si.kind = 'quiz'
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ConceptQuizItemRow, 0)
	for rows.Next() {
		var r ConceptQuizItemRow
		if err := rows.Scan(&r.ConceptID, &r.StructureItemID, &r.Title); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func GetLastPathToItem(ctx context.Context, pool *pgxpool.Pool, enrollmentID uuid.UUID) (*uuid.UUID, error) {
	var toItemID uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT to_item_id
FROM course.learner_path_events
WHERE enrollment_id = $1
ORDER BY created_at DESC
LIMIT 1
`, enrollmentID).Scan(&toItemID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &toItemID, nil
}

func ListPrerequisitesAmongIDs(ctx context.Context, pool *pgxpool.Pool, ids []uuid.UUID) ([][2]uuid.UUID, error) {
	if len(ids) == 0 {
		return [][2]uuid.UUID{}, nil
	}
	rows, err := pool.Query(ctx, `
SELECT concept_id, prerequisite_id
FROM course.concept_prerequisites
WHERE concept_id = ANY($1) AND prerequisite_id = ANY($1)
`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([][2]uuid.UUID, 0)
	for rows.Next() {
		var a, b uuid.UUID
		if err := rows.Scan(&a, &b); err != nil {
			return nil, err
		}
		out = append(out, [2]uuid.UUID{a, b})
	}
	return out, rows.Err()
}
