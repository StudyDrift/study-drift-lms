package coursemoduleassignments

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PatchWrite is the editable assignment body + structure metadata.
type PatchWrite struct {
	Markdown                     string
	DueAt                        *time.Time
	PointsWorth                  *int
	AssignmentGroupID            *uuid.UUID
	AvailableFrom                *time.Time
	AvailableUntil               *time.Time
	AssignmentAccessCode         *string
	SubmissionAllowText          bool
	SubmissionAllowFileUpload    bool
	SubmissionAllowURL           bool
	LateSubmissionPolicy         string
	LatePenaltyPercent           *int
	RubricJSON                   *json.RawMessage
	BlindGrading                 bool
	ModeratedGrading             bool
	ModerationThresholdPct       int
	ModeratorUserID              *uuid.UUID
	ProvisionalGraderUserIDs     []uuid.UUID
	OriginalityDetection         string
	OriginalityStudentVisibility string
	GradingType                  *string
	PostingPolicy                string
	ReleaseAt                    *time.Time
	NeverDrop                    bool
	ReplaceWithFinal             bool
}

// PatchForCourseItem updates assignment structure/body tables; returns false if item not found.
func PatchForCourseItem(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, w PatchWrite) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	tag, err := tx.Exec(ctx, `
		UPDATE course.course_structure_items
		SET due_at = $3,
		    assignment_group_id = $4,
		    updated_at = NOW()
		WHERE id = $1
		  AND course_id = $2
		  AND kind = 'assignment'
	`, itemID, courseID, w.DueAt, w.AssignmentGroupID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}

	var rubric any = nil
	if w.RubricJSON != nil {
		rubric = []byte(*w.RubricJSON)
	}
	tag, err = tx.Exec(ctx, `
		UPDATE course.module_assignments
		SET markdown = $2,
		    points_worth = $3,
		    available_from = $4,
		    available_until = $5,
		    assignment_access_code = $6,
		    submission_allow_text = $7,
		    submission_allow_file_upload = $8,
		    submission_allow_url = $9,
		    late_submission_policy = $10,
		    late_penalty_percent = $11,
		    rubric_json = $12,
		    blind_grading = $13,
		    moderated_grading = $14,
		    moderation_threshold_pct = $15,
		    moderator_user_id = $16,
		    provisional_grader_user_ids = $17,
		    originality_detection = $18,
		    originality_student_visibility = $19,
		    grading_type = $20,
		    posting_policy = $21,
		    release_at = $22,
		    never_drop = $23,
		    replace_with_final = $24,
		    settings_version = settings_version + 1,
		    updated_at = NOW()
		WHERE structure_item_id = $1
	`, itemID, w.Markdown, w.PointsWorth, w.AvailableFrom, w.AvailableUntil, w.AssignmentAccessCode,
		w.SubmissionAllowText, w.SubmissionAllowFileUpload, w.SubmissionAllowURL, w.LateSubmissionPolicy,
		w.LatePenaltyPercent, rubric, w.BlindGrading, w.ModeratedGrading, w.ModerationThresholdPct,
		w.ModeratorUserID, w.ProvisionalGraderUserIDs, w.OriginalityDetection, w.OriginalityStudentVisibility,
		w.GradingType, w.PostingPolicy, w.ReleaseAt, w.NeverDrop, w.ReplaceWithFinal)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

