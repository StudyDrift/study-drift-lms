package enrollment

import (
	"context"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListStudentUsersForCourseCode returns (user_id, display_label) for `student` enrollments (Rust `list_student_users_for_course_code`).
// When sectionIDs is non-empty, only students whose enrollment.section_id is in that set are returned.
func ListStudentUsersForCourseCode(ctx context.Context, pool *pgxpool.Pool, courseCode string, sectionIDs []uuid.UUID) ([]struct {
	UserID      uuid.UUID
	DisplayName string
}, error) {
	var rows pgx.Rows
	var err error
	if len(sectionIDs) == 0 {
		rows, err = pool.Query(ctx, `
		SELECT ce.user_id,
		       COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) AS display_label
		FROM course.course_enrollments ce
		INNER JOIN course.courses c ON c.id = ce.course_id
		INNER JOIN "user".users u ON u.id = ce.user_id
		WHERE c.course_code = $1 AND ce.role = 'student' AND ce.active
		ORDER BY display_label ASC, ce.user_id ASC
	`, courseCode)
	} else {
		rows, err = pool.Query(ctx, `
		SELECT ce.user_id,
		       COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) AS display_label
		FROM course.course_enrollments ce
		INNER JOIN course.courses c ON c.id = ce.course_id
		INNER JOIN "user".users u ON u.id = ce.user_id
		WHERE c.course_code = $1 AND ce.role = 'student' AND ce.active
		  AND ce.section_id = ANY($2::uuid[])
		ORDER BY display_label ASC, ce.user_id ASC
	`, courseCode, sectionIDs)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := make(map[uuid.UUID]struct{})
	var out []struct {
		UserID      uuid.UUID
		DisplayName string
	}
	for rows.Next() {
		var uid uuid.UUID
		var label string
		if err := rows.Scan(&uid, &label); err != nil {
			return nil, err
		}
		if _, ok := seen[uid]; ok {
			continue
		}
		seen[uid] = struct{}{}
		out = append(out, struct {
			UserID      uuid.UUID
			DisplayName string
		}{UserID: uid, DisplayName: label})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Stabilize order when labels duplicate (defensive; Rust also dedupes in order)
	sort.Slice(out, func(i, j int) bool {
		if out[i].DisplayName != out[j].DisplayName {
			return out[i].DisplayName < out[j].DisplayName
		}
		return out[i].UserID.String() < out[j].UserID.String()
	})
	return out, nil
}
