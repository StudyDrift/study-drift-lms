package sbg

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CourseStandardRow struct {
	ID          uuid.UUID
	CourseID    uuid.UUID
	ExternalID  *string
	Description string
	Subject     *string
	GradeLevel  *string
	Position    int32
}

type ProficiencyRow struct {
	CourseID      uuid.UUID
	StudentUserID uuid.UUID
	StandardID    uuid.UUID
	Proficiency   float64
	UpdatedAt     time.Time
}

func ListCourseStandards(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]CourseStandardRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, course_id, external_id, description, subject, grade_level, position
FROM course.sbg_standards
WHERE course_id = $1
ORDER BY position ASC, created_at ASC
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CourseStandardRow, 0)
	for rows.Next() {
		var r CourseStandardRow
		if err := rows.Scan(&r.ID, &r.CourseID, &r.ExternalID, &r.Description, &r.Subject, &r.GradeLevel, &r.Position); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func UpsertProficiency(ctx context.Context, pool *pgxpool.Pool, courseID, studentUserID, standardID uuid.UUID, proficiency float64) error {
	_, err := pool.Exec(ctx, `
INSERT INTO course.sbg_proficiencies (course_id, student_user_id, standard_id, proficiency)
VALUES ($1, $2, $3, $4)
ON CONFLICT (course_id, student_user_id, standard_id) DO UPDATE
SET proficiency = EXCLUDED.proficiency, updated_at = NOW()
`, courseID, studentUserID, standardID, proficiency)
	return err
}

func ReplaceItemAlignments(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, alignments json.RawMessage) error {
	_, err := pool.Exec(ctx, `
UPDATE course.sbg_item_alignments
SET alignments_json = $3, updated_at = NOW()
WHERE course_id = $1 AND structure_item_id = $2
`, courseID, itemID, alignments)
	return err
}
