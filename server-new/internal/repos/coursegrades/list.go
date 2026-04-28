package coursegrades

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListForCourse returns point strings, rubric maps, per-cell posted time, and excused (Rust `course_grades::list_for_course`).
func ListForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (
	grades map[string]map[string]string,
	rubricScores map[string]map[string]map[string]string,
	postedAt map[string]map[string]*time.Time,
	excused map[string]map[string]bool,
	err error,
) {
	rows, err := pool.Query(ctx, `
		SELECT student_user_id, module_item_id, points_earned, rubric_scores_json, posted_at, excused
		FROM course.course_grades
		WHERE course_id = $1
	`, courseID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	defer rows.Close()
	grades = make(map[string]map[string]string)
	rubricScores = make(map[string]map[string]map[string]string)
	postedAt = make(map[string]map[string]*time.Time)
	excused = make(map[string]map[string]bool)
	for rows.Next() {
		var studentID, itemID uuid.UUID
		var pts float64
		var rubricJSON []byte
		var post *time.Time
		var ex bool
		if err := rows.Scan(&studentID, &itemID, &pts, &rubricJSON, &post, &ex); err != nil {
			return nil, nil, nil, nil, err
		}
		su := studentID.String()
		iu := itemID.String()
		if grades[su] == nil {
			grades[su] = make(map[string]string)
		}
		grades[su][iu] = formatPointsForCell(pts)
		if postedAt[su] == nil {
			postedAt[su] = make(map[string]*time.Time)
		}
		postedAt[su][iu] = post
		if ex {
			if excused[su] == nil {
				excused[su] = make(map[string]bool)
			}
			excused[su][iu] = true
		}
		if len(rubricJSON) > 0 {
			var m map[string]float64
			if json.Unmarshal(rubricJSON, &m) == nil && len(m) > 0 {
				if rubricScores[su] == nil {
					rubricScores[su] = make(map[string]map[string]string)
				}
				if rubricScores[su][iu] == nil {
					rubricScores[su][iu] = make(map[string]string)
				}
				for k, p := range m {
					rubricScores[su][iu][k] = formatPointsForCell(p)
				}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, nil, nil, err
	}
	return grades, rubricScores, postedAt, excused, nil
}

func formatPointsForCell(pts float64) string {
	if math.IsNaN(pts) || math.IsInf(pts, 0) || pts < 0 {
		return ""
	}
	i := int64(pts)
	if math.Abs(pts-float64(i)) < 1e-9 {
		return strconv.FormatInt(i, 10)
	}
	s := strconv.FormatFloat(pts, 'f', 4, 64)
	for strings.Contains(s, ".") && (strings.HasSuffix(s, "0") || strings.HasSuffix(s, ".")) {
		s = s[:len(s)-1]
	}
	return s
}
