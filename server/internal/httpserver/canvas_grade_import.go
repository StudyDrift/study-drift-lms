package httpserver

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/repos/user"
)

// buildCanvasUserIDToLexturesUserID maps Canvas user ids (from enrollment payloads) to Lextures
// user ids when the email or login_id matches an existing account (same rules as enrollment import).
func buildCanvasUserIDToLexturesUserID(ctx context.Context, pool *pgxpool.Pool, enrollmentRows []map[string]any) map[int64]uuid.UUID {
	out := make(map[int64]uuid.UUID)
	if pool == nil {
		return out
	}
	for _, e := range enrollmentRows {
		u := objAt(e, "user")
		if u == nil {
			continue
		}
		canvasUID := int64At(u, "id")
		if canvasUID <= 0 {
			continue
		}
		email := strings.ToLower(strings.TrimSpace(strAt(u, "email", "")))
		if email == "" {
			email = strings.ToLower(strings.TrimSpace(strAt(u, "login_id", "")))
		}
		if !strings.Contains(email, "@") {
			continue
		}
		usr, ue := user.FindByEmailCI(ctx, pool, email)
		if ue != nil || usr == nil {
			continue
		}
		userID, pe := uuid.Parse(usr.ID)
		if pe != nil {
			continue
		}
		out[canvasUID] = userID
	}
	return out
}

func optionalPointsWorthFromCanvas(m map[string]any, key string) *int {
	if m == nil {
		return nil
	}
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	var f float64
	switch x := v.(type) {
	case float64:
		f = x
	case int64:
		f = float64(x)
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return nil
		}
		f = parsed
	default:
		return nil
	}
	if math.IsNaN(f) || math.IsInf(f, 0) || f < 0 {
		return nil
	}
	i := int(math.Round(f))
	if i > 1000000 {
		i = 1000000
	}
	return &i
}

func submissionScoreAndExcused(sub map[string]any) (excused bool, score float64, hasScore bool) {
	if sub == nil {
		return false, 0, false
	}
	excused = boolAt(sub, "excused", false)
	if excused {
		return true, 0, false
	}
	// Canvas omits "score" or sets null when not graded.
	if v, ok := sub["score"]; ok && v != nil {
		switch x := v.(type) {
		case float64:
			if !math.IsNaN(x) && !math.IsInf(x, 0) {
				return false, x, true
			}
		case int64:
			return false, float64(x), true
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
			if err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0) {
				return false, parsed, true
			}
		}
	}
	return false, 0, false
}

func upsertCourseGradeFromCanvas(
	ctx context.Context,
	tx pgx.Tx,
	courseID, studentID, moduleItemID uuid.UUID,
	pointsEarned float64,
	excused bool,
) error {
	if pointsEarned < 0 {
		pointsEarned = 0
	}
	if pointsEarned > 1e9 {
		pointsEarned = 1e9
	}
	_, err := tx.Exec(ctx, `
INSERT INTO course.course_grades (
	course_id, student_user_id, module_item_id, points_earned, updated_at, posted_at, excused
) VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)
ON CONFLICT (student_user_id, module_item_id) DO UPDATE SET
	course_id = EXCLUDED.course_id,
	points_earned = EXCLUDED.points_earned,
	updated_at = NOW(),
	posted_at = EXCLUDED.posted_at,
	excused = EXCLUDED.excused
`, courseID, studentID, moduleItemID, pointsEarned, excused)
	return err
}

func canvasImportAssignmentGrades(
	ctx context.Context,
	tx pgx.Tx,
	client *http.Client,
	canvasBase, accessToken string,
	canvasCourseID int64,
	courseID uuid.UUID,
	canvasAssignToItem map[int64]uuid.UUID,
	canvasUserToLocal map[int64]uuid.UUID,
) error {
	for canvasAID, itemID := range canvasAssignToItem {
		subs, err := canvasGetArrayPaginated(ctx, client, canvasBase, accessToken,
			fmt.Sprintf("courses/%d/assignments/%d/submissions", canvasCourseID, canvasAID), nil)
		if err != nil {
			return fmt.Errorf("Canvas assignment %d submissions: %w", canvasAID, err)
		}
		for _, raw := range subs {
			canvasUserID := int64At(raw, "user_id")
			if canvasUserID <= 0 {
				continue
			}
			studentID, ok := canvasUserToLocal[canvasUserID]
			if !ok {
				continue
			}
			exc, score, hasScore := submissionScoreAndExcused(raw)
			if !exc && !hasScore {
				continue
			}
			pts := 0.0
			if hasScore {
				pts = score
			}
			if err := upsertCourseGradeFromCanvas(ctx, tx, courseID, studentID, itemID, pts, exc); err != nil {
				return fmt.Errorf("save grade for assignment canvas id %d: %w", canvasAID, err)
			}
		}
	}
	return nil
}

func canvasImportQuizGrades(
	ctx context.Context,
	tx pgx.Tx,
	client *http.Client,
	canvasBase, accessToken string,
	canvasCourseID int64,
	courseID uuid.UUID,
	canvasQuizToItem map[int64]uuid.UUID,
	canvasUserToLocal map[int64]uuid.UUID,
) error {
	for canvasQID, itemID := range canvasQuizToItem {
		subs, err := canvasGetArrayPaginated(ctx, client, canvasBase, accessToken,
			fmt.Sprintf("courses/%d/quizzes/%d/submissions", canvasCourseID, canvasQID), nil)
		if err != nil {
			return fmt.Errorf("Canvas quiz %d submissions: %w", canvasQID, err)
		}
		for _, raw := range subs {
			canvasUserID := int64At(raw, "user_id")
			if canvasUserID <= 0 {
				continue
			}
			studentID, ok := canvasUserToLocal[canvasUserID]
			if !ok {
				continue
			}
			exc := boolAt(raw, "excused", false)
			var score float64
			hasScore := false
			if !exc {
				// Prefer kept_score (historical); fall back to score.
				if v, ok := raw["kept_score"]; ok && v != nil {
					switch x := v.(type) {
					case float64:
						if !math.IsNaN(x) && !math.IsInf(x, 0) {
							score, hasScore = x, true
						}
					case int64:
						score, hasScore = float64(x), true
					}
				}
				if !hasScore {
					_, sc, okSc := submissionScoreAndExcused(raw)
					if okSc {
						score, hasScore = sc, true
					}
				}
			}
			if !exc && !hasScore {
				continue
			}
			pts := 0.0
			if hasScore {
				pts = score
			}
			if err := upsertCourseGradeFromCanvas(ctx, tx, courseID, studentID, itemID, pts, exc); err != nil {
				return fmt.Errorf("save grade for quiz canvas id %d: %w", canvasQID, err)
			}
		}
	}
	return nil
}

func canvasImportAllCanvasGrades(
	ctx context.Context,
	tx pgx.Tx,
	client *http.Client,
	canvasBase, accessToken string,
	canvasCourseID int64,
	courseID uuid.UUID,
	canvasAssignToItem map[int64]uuid.UUID,
	canvasQuizToItem map[int64]uuid.UUID,
	canvasUserToLocal map[int64]uuid.UUID,
) error {
	if len(canvasUserToLocal) == 0 {
		return nil
	}
	if err := canvasImportAssignmentGrades(ctx, tx, client, canvasBase, accessToken, canvasCourseID, courseID, canvasAssignToItem, canvasUserToLocal); err != nil {
		return err
	}
	if err := canvasImportQuizGrades(ctx, tx, client, canvasBase, accessToken, canvasCourseID, courseID, canvasQuizToItem, canvasUserToLocal); err != nil {
		return err
	}
	return nil
}
