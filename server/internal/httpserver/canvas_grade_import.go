package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/repos/user"
)

// normalizedLexturesEmailGuessFromCanvasUserMap picks a plausible email-ish login from a Canvas User
// (course roster payloads often include primary email here; enrollment-embedded mini users omit it often).
func normalizedLexturesEmailGuessFromCanvasUserMap(u map[string]any) string {
	if u == nil {
		return ""
	}
	em := strings.ToLower(strings.TrimSpace(strAt(u, "email", "")))
	if strings.Contains(em, "@") {
		return em
	}
	lid := strings.ToLower(strings.TrimSpace(strAt(u, "login_id", "")))
	if strings.Contains(lid, "@") {
		return lid
	}
	return ""
}

func lexturesUUIDForMatchedCanvasEmail(ctx context.Context, pool *pgxpool.Pool, emailGuess string) (uuid.UUID, bool) {
	if pool == nil || emailGuess == "" || !strings.Contains(emailGuess, "@") {
		return uuid.Nil, false
	}
	usr, ue := user.FindByEmailCI(ctx, pool, emailGuess)
	if ue != nil || usr == nil {
		return uuid.Nil, false
	}
	userID, pe := uuid.Parse(usr.ID)
	if pe != nil {
		return uuid.Nil, false
	}
	return userID, true
}

func canvasListCourseUsersByEnrollmentType(
	ctx context.Context,
	client *http.Client,
	canvasBase, accessToken string,
	canvasCourseID int64,
	enrollmentType string,
) ([]map[string]any, error) {
	q := url.Values{}
	q.Add("enrollment_type[]", enrollmentType)
	path := fmt.Sprintf("courses/%d/users", canvasCourseID)
	return canvasGetArrayPaginated(ctx, client, canvasBase, accessToken, path, q)
}

// canvasListCourseStudentUsersForGradeMatch loads student roster emails for grading.
// Prefer enrollment_type=student; Canvas sites with bespoke student roles may return an empty list, so we fall back to enrollment_role=StudentEnrollment.
func canvasListCourseStudentUsersForGradeMatch(
	ctx context.Context,
	client *http.Client,
	canvasBase, accessToken string,
	canvasCourseID int64,
) ([]map[string]any, error) {
	path := fmt.Sprintf("courses/%d/users", canvasCourseID)
	if roster, err := canvasListCourseUsersByEnrollmentType(ctx, client, canvasBase, accessToken, canvasCourseID, "student"); err != nil {
		return nil, err
	} else if len(roster) > 0 {
		return roster, nil
	}
	q := url.Values{}
	q.Set("enrollment_role", "StudentEnrollment")
	return canvasGetArrayPaginated(ctx, client, canvasBase, accessToken, path, q)
}

// buildCanvasUserIDToLexturesUserID maps Canvas roster user ids → Lextures user ids using email/login.
// Enrollment rows augment the roster when roster rows are unavailable or omit some learners (same lookup rules as enrollment import).
func buildCanvasUserIDToLexturesUserID(
	ctx context.Context,
	pool *pgxpool.Pool,
	client *http.Client,
	canvasBase, accessToken string,
	canvasCourseID int64,
	enrollmentRows []map[string]any,
) map[int64]uuid.UUID {
	// #region agent log
	rosterLen := 0
	rosterFetchErr := false
	rosterEmailGuessRows := 0
	// #endregion agent log

	out := make(map[int64]uuid.UUID)
	if pool == nil {
		// #region agent log
		canvasAgentDebugLog("canvas-import", "H1", "canvas_grade_import.go:buildCanvasUserIDToLexturesUserID", "user map skipped (nil pool)", map[string]any{
			"finalMappingSize": 0,
		})
		// #endregion agent log
		return out
	}
	if client != nil {
		roster, err := canvasListCourseStudentUsersForGradeMatch(ctx, client, canvasBase, accessToken, canvasCourseID)
		if err != nil {
			// #region agent log
			rosterFetchErr = true
			// #endregion agent log
		} else {
			// #region agent log
			rosterLen = len(roster)
			// #endregion agent log
			for _, u := range roster {
				canvasUID := int64At(u, "id")
				if canvasUID <= 0 {
					continue
				}
				if eg := normalizedLexturesEmailGuessFromCanvasUserMap(u); eg != "" {
					// #region agent log
					rosterEmailGuessRows++
					// #endregion agent log
					if userID, ok := lexturesUUIDForMatchedCanvasEmail(ctx, pool, eg); ok {
						out[canvasUID] = userID
					}
				}
			}
		}
	}

	// #region agent log
	enrollmentEmailGuessRows := 0
	// #endregion agent log
	for _, e := range enrollmentRows {
		u := objAt(e, "user")
		if u == nil {
			continue
		}
		canvasUID := int64At(u, "id")
		if canvasUID <= 0 {
			continue
		}
		if _, dup := out[canvasUID]; dup {
			continue
		}
		if eg := normalizedLexturesEmailGuessFromCanvasUserMap(u); eg != "" {
			// #region agent log
			enrollmentEmailGuessRows++
			// #endregion agent log
			if userID, ok := lexturesUUIDForMatchedCanvasEmail(ctx, pool, eg); ok {
				out[canvasUID] = userID
			}
		}
	}

	// #region agent log
	canvasAgentDebugLog("canvas-import", "H1", "canvas_grade_import.go:buildCanvasUserIDToLexturesUserID", "canvas→lextures user mapping summary", map[string]any{
		"rosterLen":                 rosterLen,
		"rosterFetchErr":            rosterFetchErr,
		"rosterRowsWithEmailGuess":  rosterEmailGuessRows,
		"enrollmentRows":            len(enrollmentRows),
		"enrollmentRowsEmailGuess":  enrollmentEmailGuessRows,
		"finalMappingSize":          len(out),
	})
	// #endregion agent log
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

// coerceCanvasJSONNumber parses Canvas JSON numeric fields (normally float64 from encoding/json).
func coerceCanvasJSONNumber(v any) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch x := v.(type) {
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return 0, false
		}
		return x, true
	case int64:
		return float64(x), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0, false
		}
		return parsed, true
	case json.Number:
		parsed, err := x.Float64()
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func submissionScoreAndExcused(sub map[string]any) (excused bool, score float64, hasScore bool) {
	if sub == nil {
		return false, 0, false
	}
	excused = boolAt(sub, "excused", false)
	if excused {
		return true, 0, false
	}
	if sc, ok := coerceCanvasJSONNumber(sub["score"]); ok {
		return false, sc, true
	}
	if hist, ok := sub["submission_history"].([]any); ok && len(hist) > 0 {
		for i := len(hist) - 1; i >= 0; i-- {
			hm, ok := hist[i].(map[string]any)
			if !ok || hm == nil {
				continue
			}
			if boolAt(hm, "excused", false) {
				continue
			}
			if sc, ok := coerceCanvasJSONNumber(hm["score"]); ok {
				return false, sc, true
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
	// #region agent log
	assignCanvasIDs := int64(len(canvasAssignToItem))
	var totalSubs int64
	var skipBadCanvasUID int64
	var skipNoLocalUser int64
	var skipNoScore int64
	var upserts int64
	// #endregion agent log

	assignmentSubsQuery := url.Values{}
	assignmentSubsQuery.Add("include[]", "submission_history")
	for canvasAID, itemID := range canvasAssignToItem {
		subs, err := canvasGetArrayPaginated(ctx, client, canvasBase, accessToken,
			fmt.Sprintf("courses/%d/assignments/%d/submissions", canvasCourseID, canvasAID), assignmentSubsQuery)
		if err != nil {
			return fmt.Errorf("Canvas assignment %d submissions: %w", canvasAID, err)
		}
		// #region agent log
		totalSubs += int64(len(subs))
		// #endregion agent log
		for _, raw := range subs {
			canvasUserID := int64At(raw, "user_id")
			if canvasUserID <= 0 {
				// #region agent log
				skipBadCanvasUID++
				// #endregion agent log
				continue
			}
			studentID, ok := canvasUserToLocal[canvasUserID]
			if !ok {
				// #region agent log
				skipNoLocalUser++
				// #endregion agent log
				continue
			}
			exc, score, hasScore := submissionScoreAndExcused(raw)
			if !exc && !hasScore {
				// #region agent log
				skipNoScore++
				// #endregion agent log
				continue
			}
			pts := 0.0
			if hasScore {
				pts = score
			}
			if err := upsertCourseGradeFromCanvas(ctx, tx, courseID, studentID, itemID, pts, exc); err != nil {
				return fmt.Errorf("save grade for assignment canvas id %d: %w", canvasAID, err)
			}
			// #region agent log
			upserts++
			// #endregion agent log
		}
	}

	// #region agent log
	canvasAgentDebugLog("canvas-import", "H2-H4", "canvas_grade_import.go:canvasImportAssignmentGrades", "assignment submission import counters", map[string]any{
		"assignmentCanvasIDs": assignCanvasIDs,
		"totalSubmissionRows": totalSubs,
		"skipBadCanvasUserID": skipBadCanvasUID,
		"skipNoMappedUser":    skipNoLocalUser,
		"skipNoScore":         skipNoScore,
		"gradesUpserted":      upserts,
	})
	// #endregion agent log
	return nil
}

// Quiz submission list responses wrap rows in {"quiz_submissions":[...]} (not a bare JSON array).
func canvasUnpackQuizSubmissionResponse(v any) []map[string]any {
	switch t := v.(type) {
	case map[string]any:
		raw, ok := t["quiz_submissions"].([]any)
		if !ok || len(raw) == 0 {
			return nil
		}
		out := make([]map[string]any, 0, len(raw))
		for _, it := range raw {
			if m, ok := it.(map[string]any); ok && m != nil {
				out = append(out, m)
			}
		}
		return out
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, it := range t {
			if m, ok := it.(map[string]any); ok && m != nil {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func canvasGetQuizSubmissionsPaginated(
	ctx context.Context,
	client *http.Client,
	base, token string,
	canvasCourseID, quizID int64,
	q url.Values,
) ([]map[string]any, error) {
	out := make([]map[string]any, 0)
	for page := 1; ; page++ {
		qp := cloneQuery(q)
		qp.Set("per_page", "100")
		qp.Set("page", strconv.Itoa(page))
		v, err := canvasGetJSON(ctx, client, base, token,
			fmt.Sprintf("courses/%d/quizzes/%d/submissions", canvasCourseID, quizID), qp)
		if err != nil {
			return nil, err
		}
		chunk := canvasUnpackQuizSubmissionResponse(v)
		if len(chunk) == 0 {
			break
		}
		out = append(out, chunk...)
		if len(chunk) < 100 {
			break
		}
	}
	return out, nil
}

// quizSubmissionImportRank assigns a sortable priority when Canvas returns multiple attempts per learner.
func quizSubmissionImportRank(m map[string]any) int64 {
	if m == nil {
		return -1
	}
	state := strings.ToLower(strings.TrimSpace(strAt(m, "workflow_state", "")))
	att := int64At(m, "attempt")
	switch state {
	case "complete":
		return 1_000_000 + att
	case "pending_review":
		return 500_000 + att
	default:
		return att
	}
}

func pickPreferredQuizSubmissionForUser(existing, candidate map[string]any) map[string]any {
	if existing == nil {
		return candidate
	}
	if quizSubmissionImportRank(candidate) >= quizSubmissionImportRank(existing) {
		return candidate
	}
	return existing
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
	// #region agent log
	quizCanvasIDs := int64(len(canvasQuizToItem))
	var totalQuizSubs int64
	var quizSkipNotInLocalMap int64
	var quizMergedLearners int64
	var quizSkipNoScore int64
	var quizUpserts int64
	// #endregion agent log

	for canvasQID, itemID := range canvasQuizToItem {
		subs, err := canvasGetQuizSubmissionsPaginated(ctx, client, canvasBase, accessToken, canvasCourseID, canvasQID, nil)
		if err != nil {
			return fmt.Errorf("Canvas quiz %d submissions: %w", canvasQID, err)
		}
		// #region agent log
		totalQuizSubs += int64(len(subs))
		// #endregion agent log
		byCanvasUser := make(map[int64]map[string]any)
		for _, raw := range subs {
			canvasUserID := int64At(raw, "user_id")
			if canvasUserID <= 0 {
				continue
			}
			if _, wants := canvasUserToLocal[canvasUserID]; !wants {
				// #region agent log
				quizSkipNotInLocalMap++
				// #endregion agent log
				continue
			}
			prev := byCanvasUser[canvasUserID]
			byCanvasUser[canvasUserID] = pickPreferredQuizSubmissionForUser(prev, raw)
		}
		// #region agent log
		quizMergedLearners += int64(len(byCanvasUser))
		// #endregion agent log
		for canvasUserID, raw := range byCanvasUser {
			studentID, ok := canvasUserToLocal[canvasUserID]
			if !ok {
				continue
			}
			exc := boolAt(raw, "excused", false)
			score := 0.0
			hasScore := false
			if !exc {
				if v, ok := raw["kept_score"]; ok {
					if n, ok2 := coerceCanvasJSONNumber(v); ok2 {
						score, hasScore = n, true
					}
				}
				if !hasScore {
					if v, ok := raw["score"]; ok {
						if n, ok2 := coerceCanvasJSONNumber(v); ok2 {
							score, hasScore = n, true
						}
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
				// #region agent log
				quizSkipNoScore++
				// #endregion agent log
				continue
			}
			pts := 0.0
			if hasScore {
				pts = score
			}
			if err := upsertCourseGradeFromCanvas(ctx, tx, courseID, studentID, itemID, pts, exc); err != nil {
				return fmt.Errorf("save grade for quiz canvas id %d: %w", canvasQID, err)
			}
			// #region agent log
			quizUpserts++
			// #endregion agent log
		}
	}

	// #region agent log
	canvasAgentDebugLog("canvas-import", "H2-H4", "canvas_grade_import.go:canvasImportQuizGrades", "quiz submission import counters", map[string]any{
		"quizCanvasIDs":          quizCanvasIDs,
		"totalQuizSubmissionRaw": totalQuizSubs,
		"skippedRawNoLocalMatch": quizSkipNotInLocalMap,
		"mergedLearners":         quizMergedLearners,
		"skippedNoScore":         quizSkipNoScore,
		"gradesUpserted":         quizUpserts,
	})
	// #endregion agent log
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
	// #region agent log
	canvasAgentDebugLog("canvas-import", "H2,H5", "canvas_grade_import.go:canvasImportAllCanvasGrades", "entering aggregated grade import", map[string]any{
		"mappedCanvasUsers": len(canvasUserToLocal),
		"assignmentIDs":     len(canvasAssignToItem),
		"quizIDs":           len(canvasQuizToItem),
	})
	// #endregion agent log
	if len(canvasUserToLocal) == 0 {
		// #region agent log
		canvasAgentDebugLog("canvas-import", "H5", "canvas_grade_import.go:canvasImportAllCanvasGrades", "early exit — no Canvas users mapped to Lex accounts", map[string]any{})
		// #endregion agent log
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
