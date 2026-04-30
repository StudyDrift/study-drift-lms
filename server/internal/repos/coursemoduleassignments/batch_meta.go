package coursemoduleassignments

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RubricByItemID returns rubric_json for the given assignment structure item ids.
func RubricByItemID(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, itemIDs []uuid.UUID) (map[uuid.UUID][]byte, error) {
	if len(itemIDs) == 0 {
		return map[uuid.UUID][]byte{}, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT c.id, m.rubric_json
		FROM course.course_structure_items c
		INNER JOIN course.module_assignments m ON m.structure_item_id = c.id
		WHERE c.course_id = $1 AND c.kind = 'assignment' AND c.id = ANY($2)
	`, courseID, itemIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID][]byte)
	for rows.Next() {
		var id uuid.UUID
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			out[id] = raw
		}
	}
	return out, rows.Err()
}

// PostingByItemID returns posting_policy and release_at for assignment items.
func PostingByItemID(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, itemIDs []uuid.UUID) (map[uuid.UUID]struct {
	Policy    string
	ReleaseAt *time.Time
}, error) {
	if len(itemIDs) == 0 {
		return map[uuid.UUID]struct {
			Policy    string
			ReleaseAt *time.Time
		}{}, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT c.id, m.posting_policy, m.release_at
		FROM course.course_structure_items c
		INNER JOIN course.module_assignments m ON m.structure_item_id = c.id
		WHERE c.course_id = $1 AND c.kind = 'assignment' AND c.id = ANY($2)
	`, courseID, itemIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]struct {
		Policy    string
		ReleaseAt *time.Time
	})
	for rows.Next() {
		var id uuid.UUID
		var pol string
		var rel *time.Time
		if err := rows.Scan(&id, &pol, &rel); err != nil {
			return nil, err
		}
		out[id] = struct {
			Policy    string
			ReleaseAt *time.Time
		}{Policy: pol, ReleaseAt: rel}
	}
	return out, rows.Err()
}

// GradingTypeByItemID returns module_assignments.grading_type per structure item.
func GradingTypeByItemID(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, itemIDs []uuid.UUID) (map[uuid.UUID]*string, error) {
	if len(itemIDs) == 0 {
		return map[uuid.UUID]*string{}, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT c.id, m.grading_type
		FROM course.course_structure_items c
		INNER JOIN course.module_assignments m ON m.structure_item_id = c.id
		WHERE c.course_id = $1 AND c.kind = 'assignment' AND c.id = ANY($2)
	`, courseID, itemIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]*string)
	for rows.Next() {
		var id uuid.UUID
		var gt *string
		if err := rows.Scan(&id, &gt); err != nil {
			return nil, err
		}
		if gt != nil && *gt != "" {
			v := *gt
			out[id] = &v
		}
	}
	return out, rows.Err()
}

// ItemDropFlagsForCourse returns (never_drop, replace_with_final) for assignment and quiz items (Rust `item_drop_flags_for_course`).
func ItemDropFlagsForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (map[uuid.UUID]struct{ NeverDrop, ReplaceWithFinal bool }, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id,
		       COALESCE(m.never_drop, q.never_drop, false) AS never_drop,
		       COALESCE(m.replace_with_final, q.replace_with_final, false) AS replace_with_final
		FROM course.course_structure_items c
		LEFT JOIN course.module_assignments m ON m.structure_item_id = c.id AND c.kind = 'assignment'
		LEFT JOIN course.module_quizzes q ON q.structure_item_id = c.id AND c.kind = 'quiz'
		WHERE c.course_id = $1 AND c.kind IN ('assignment', 'quiz')
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]struct{ NeverDrop, ReplaceWithFinal bool })
	for rows.Next() {
		var id uuid.UUID
		var never, repFinal bool
		if err := rows.Scan(&id, &never, &repFinal); err != nil {
			return nil, err
		}
		out[id] = struct{ NeverDrop, ReplaceWithFinal bool }{NeverDrop: never, ReplaceWithFinal: repFinal}
	}
	return out, rows.Err()
}
