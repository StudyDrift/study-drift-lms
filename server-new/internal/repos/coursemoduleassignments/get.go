package coursemoduleassignments

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CourseItemAssignmentRow is `server/src/repos/course_module_assignments::CourseItemAssignmentRow`.
type CourseItemAssignmentRow struct {
	Title                        string
	Markdown                     string
	DueAt                        *time.Time
	PointsWorth                  *int
	AssignmentGroupID            *uuid.UUID
	UpdatedAt                    time.Time
	AvailableFrom                *time.Time
	AvailableUntil               *time.Time
	AssignmentAccessCode         *string
	SubmissionAllowText          bool
	SubmissionAllowFileUpload    bool
	SubmissionAllowURL           bool
	LateSubmissionPolicy         string
	LatePenaltyPercent           *int
	RubricJSON                   []byte
	BlindGrading                 bool
	IdentitiesRevealedAt         *time.Time
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

// GetForCourseItem returns assignment body + structure fields for a module assignment item.
func GetForCourseItem(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) (*CourseItemAssignmentRow, error) {
	var r CourseItemAssignmentRow
	err := pool.QueryRow(ctx, `
		SELECT c.title, m.markdown, c.due_at, m.points_worth, c.assignment_group_id, m.updated_at,
		       m.available_from, m.available_until, m.assignment_access_code,
		       m.submission_allow_text, m.submission_allow_file_upload, m.submission_allow_url,
		       m.late_submission_policy, m.late_penalty_percent, m.rubric_json,
		       m.blind_grading, m.identities_revealed_at,
		       m.moderated_grading, m.moderation_threshold_pct, m.moderator_user_id,
		       m.provisional_grader_user_ids,
		       m.originality_detection, m.originality_student_visibility,
		       m.grading_type, m.posting_policy, m.release_at,
		       m.never_drop, m.replace_with_final
		FROM course.course_structure_items c
		INNER JOIN course.module_assignments m ON m.structure_item_id = c.id
		WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
	`, itemID, courseID).Scan(
		&r.Title, &r.Markdown, &r.DueAt, &r.PointsWorth, &r.AssignmentGroupID, &r.UpdatedAt,
		&r.AvailableFrom, &r.AvailableUntil, &r.AssignmentAccessCode,
		&r.SubmissionAllowText, &r.SubmissionAllowFileUpload, &r.SubmissionAllowURL,
		&r.LateSubmissionPolicy, &r.LatePenaltyPercent, &r.RubricJSON,
		&r.BlindGrading, &r.IdentitiesRevealedAt,
		&r.ModeratedGrading, &r.ModerationThresholdPct, &r.ModeratorUserID,
		&r.ProvisionalGraderUserIDs,
		&r.OriginalityDetection, &r.OriginalityStudentVisibility,
		&r.GradingType, &r.PostingPolicy, &r.ReleaseAt,
		&r.NeverDrop, &r.ReplaceWithFinal,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// OptionalRubricJSON is non-nil when rubric should appear in the API.
func (r *CourseItemAssignmentRow) OptionalRubricJSON() *json.RawMessage {
	if len(r.RubricJSON) == 0 {
		return nil
	}
	raw := json.RawMessage(append([]byte(nil), r.RubricJSON...))
	return &raw
}
