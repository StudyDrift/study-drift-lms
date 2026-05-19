package course

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CoursePublic is the JSON body for a course in list/detail APIs (camelCase, matches Rust `CoursePublic`).
type CoursePublic struct {
	ID                            string           `json:"id"`
	CourseCode                    string           `json:"courseCode"`
	Title                         string           `json:"title"`
	Description                   string           `json:"description"`
	HeroImageURL                  *string          `json:"heroImageUrl"`
	HeroImageObjectPosition       *string          `json:"heroImageObjectPosition"`
	StartsAt                      *time.Time       `json:"startsAt"`
	EndsAt                        *time.Time       `json:"endsAt"`
	VisibleFrom                   *time.Time       `json:"visibleFrom"`
	HiddenAt                      *time.Time       `json:"hiddenAt"`
	ScheduleMode                  string           `json:"scheduleMode"`
	RelativeEndAfter              *string          `json:"relativeEndAfter"`
	RelativeHiddenAfter           *string          `json:"relativeHiddenAfter"`
	RelativeScheduleAnchorAt      *time.Time       `json:"relativeScheduleAnchorAt"`
	Published                     bool             `json:"published"`
	MarkdownThemePreset           string           `json:"markdownThemePreset"`
	MarkdownThemeCustom           *json.RawMessage `json:"markdownThemeCustom"`
	GradingScale                  string           `json:"gradingScale"`
	Archived                      bool             `json:"archived"`
	NotebookEnabled               bool             `json:"notebookEnabled"`
	FeedEnabled                   bool             `json:"feedEnabled"`
	CalendarEnabled               bool             `json:"calendarEnabled"`
	QuestionBankEnabled           bool             `json:"questionBankEnabled"`
	LockdownModeEnabled           bool             `json:"lockdownModeEnabled"`
	StandardsAlignmentEnabled     bool             `json:"standardsAlignmentEnabled"`
	AdaptivePathsEnabled          bool             `json:"adaptivePathsEnabled"`
	SRSEnabled                    bool             `json:"srsEnabled"`
	DiagnosticAssessmentsEnabled  bool             `json:"diagnosticAssessmentsEnabled"`
	HintScaffoldingEnabled        bool             `json:"hintScaffoldingEnabled"`
	MisconceptionDetectionEnabled bool             `json:"misconceptionDetectionEnabled"`
	SectionsEnabled               bool             `json:"sectionsEnabled"`
	DiscussionsEnabled            bool             `json:"discussionsEnabled"`
	CollabDocsEnabled             bool             `json:"collabDocsEnabled"`
	LiveSessionsEnabled           bool             `json:"liveSessionsEnabled"`
	CourseType                    string           `json:"courseType"`
	CreatedAt                     time.Time        `json:"createdAt"`
	UpdatedAt                     time.Time        `json:"updatedAt"`
	OrgID                         *string          `json:"orgId,omitempty"`
	SbgEnabled                    bool             `json:"sbgEnabled"`
	SbgProficiencyScaleJSON       *json.RawMessage `json:"sbgProficiencyScaleJson"`
	SbgAggregationRule            string           `json:"sbgAggregationRule"`
	OrgUnitID                     *string          `json:"orgUnitId,omitempty"`
	TermID                        *string          `json:"termId,omitempty"`
	Term                          *TermSummary     `json:"term,omitempty"`
	IsBlueprint                   bool             `json:"isBlueprint"`
	BlueprintParentID             *string          `json:"blueprintParentId,omitempty"`
	BlueprintParentCourseCode     *string          `json:"blueprintParentCourseCode,omitempty"`
	BlueprintLastSyncAt           *time.Time       `json:"blueprintLastSyncAt,omitempty"`
	CourseHomeLanding             string           `json:"courseHomeLanding"`
	CourseHomeContentItemID       *string          `json:"courseHomeContentItemId,omitempty"`
}

// coursePublicSelect is columns for `course.courses` joined to `tenant.terms` (alias `tr`) for public APIs.
const coursePublicSelect = `
    c.id,
    c.org_id,
    c.course_code,
    c.title,
    c.description,
    c.hero_image_url,
    c.hero_image_object_position,
    c.starts_at,
    c.ends_at,
    c.visible_from,
    c.hidden_at,
    c.schedule_mode,
    c.relative_end_after,
    c.relative_hidden_after,
    c.relative_schedule_anchor_at,
    c.published,
    c.markdown_theme_preset,
    c.markdown_theme_custom,
    c.grading_scale,
    c.archived,
    c.notebook_enabled,
    c.feed_enabled,
    c.calendar_enabled,
    c.question_bank_enabled,
    c.lockdown_mode_enabled,
    c.standards_alignment_enabled,
    c.adaptive_paths_enabled,
    c.srs_enabled,
    c.diagnostic_assessments_enabled,
    c.hint_scaffolding_enabled,
    c.misconception_detection_enabled,
    c.sections_enabled,
    c.discussions_enabled,
    c.collab_docs_enabled,
    c.live_sessions_enabled,
    c.course_type,
    c.created_at,
    c.updated_at,
    c.sbg_enabled,
    c.sbg_proficiency_scale_json,
    c.sbg_aggregation_rule,
    c.org_unit_id,
    c.is_blueprint,
    c.blueprint_parent_id,
    bp.course_code AS blueprint_parent_course_code,
    c.blueprint_last_sync_at,
    c.course_home_landing,
    c.course_home_content_item_id,
    c.term_id,
    tr.id,
    tr.name,
    tr.term_type,
    tr.start_date::text,
    tr.end_date::text,
    tr.status
`

const coursePublicFrom = `
FROM course.courses c
LEFT JOIN course.courses bp ON bp.id = c.blueprint_parent_id
LEFT JOIN tenant.terms tr ON tr.id = c.term_id
`

func scanCoursePublicFromRow(row pgx.Row) (CoursePublic, error) {
	var p CoursePublic
	var id uuid.UUID
	var hero, heroPos, relEnd, relHide sql.NullString
	var starts, ends, vis, hid, relAnchor sql.NullTime
	var mtheme, sbgProf []byte
	var sbgRule string
	var orgUnit sql.NullString
	var orgIDCol sql.NullString
	var bpParentID, bpParentCode sql.NullString
	var bpLastSync sql.NullTime
	var homeLanding string
	var homeContentItem pgtype.UUID
	var termIDCol, trID sql.NullString
	var trName, trType, trStart, trEnd, trStatus sql.NullString

	if err := row.Scan(
		&id,
		&orgIDCol,
		&p.CourseCode,
		&p.Title,
		&p.Description,
		&hero,
		&heroPos,
		&starts,
		&ends,
		&vis,
		&hid,
		&p.ScheduleMode,
		&relEnd,
		&relHide,
		&relAnchor,
		&p.Published,
		&p.MarkdownThemePreset,
		&mtheme,
		&p.GradingScale,
		&p.Archived,
		&p.NotebookEnabled,
		&p.FeedEnabled,
		&p.CalendarEnabled,
		&p.QuestionBankEnabled,
		&p.LockdownModeEnabled,
		&p.StandardsAlignmentEnabled,
		&p.AdaptivePathsEnabled,
		&p.SRSEnabled,
		&p.DiagnosticAssessmentsEnabled,
		&p.HintScaffoldingEnabled,
		&p.MisconceptionDetectionEnabled,
		&p.SectionsEnabled,
		&p.DiscussionsEnabled,
		&p.CollabDocsEnabled,
		&p.LiveSessionsEnabled,
		&p.CourseType,
		&p.CreatedAt,
		&p.UpdatedAt,
		&p.SbgEnabled,
		&sbgProf,
		&sbgRule,
		&orgUnit,
		&p.IsBlueprint,
		&bpParentID,
		&bpParentCode,
		&bpLastSync,
		&homeLanding,
		&homeContentItem,
		&termIDCol,
		&trID,
		&trName,
		&trType,
		&trStart,
		&trEnd,
		&trStatus,
	); err != nil {
		return CoursePublic{}, err
	}

	p.ID = id.String()
	if orgIDCol.Valid && strings.TrimSpace(orgIDCol.String) != "" {
		s := orgIDCol.String
		p.OrgID = &s
	}
	if orgUnit.Valid {
		s := orgUnit.String
		p.OrgUnitID = &s
	}
	if bpParentID.Valid && strings.TrimSpace(bpParentID.String) != "" {
		s := bpParentID.String
		p.BlueprintParentID = &s
	}
	if bpParentCode.Valid && strings.TrimSpace(bpParentCode.String) != "" {
		s := bpParentCode.String
		p.BlueprintParentCourseCode = &s
	}
	p.BlueprintLastSyncAt = nullTimePtr(bpLastSync)
	p.CourseHomeLanding = strings.TrimSpace(homeLanding)
	if p.CourseHomeLanding == "" {
		p.CourseHomeLanding = "data"
	}
	if homeContentItem.Valid {
		u, err := uuid.FromBytes(homeContentItem.Bytes[:])
		if err == nil {
			s := u.String()
			p.CourseHomeContentItemID = &s
		}
	}
	if hero.Valid {
		s := hero.String
		p.HeroImageURL = &s
	}
	if heroPos.Valid {
		s := heroPos.String
		p.HeroImageObjectPosition = &s
	}
	p.StartsAt = nullTimePtr(starts)
	p.EndsAt = nullTimePtr(ends)
	p.VisibleFrom = nullTimePtr(vis)
	p.HiddenAt = nullTimePtr(hid)
	if relEnd.Valid {
		s := relEnd.String
		p.RelativeEndAfter = &s
	}
	if relHide.Valid {
		s := relHide.String
		p.RelativeHiddenAfter = &s
	}
	p.RelativeScheduleAnchorAt = nullTimePtr(relAnchor)
	if len(mtheme) > 0 {
		raw := json.RawMessage(mtheme)
		p.MarkdownThemeCustom = &raw
	}
	if len(sbgProf) > 0 {
		raw := json.RawMessage(sbgProf)
		p.SbgProficiencyScaleJSON = &raw
	}
	p.SbgAggregationRule = sbgRule
	if termIDCol.Valid && strings.TrimSpace(termIDCol.String) != "" {
		s := termIDCol.String
		p.TermID = &s
	}
	if trID.Valid && trName.Valid && trType.Valid && trStart.Valid && trEnd.Valid && trStatus.Valid {
		p.Term = &TermSummary{
			ID:        trID.String,
			Name:      trName.String,
			TermType:  trType.String,
			StartDate: trStart.String,
			EndDate:   trEnd.String,
			Status:    trStatus.String,
		}
	}
	return p, nil
}

// GetPublicByCourseCode returns a course by `course.courses.course_code`, or nil if not found.
func GetPublicByCourseCode(ctx context.Context, pool *pgxpool.Pool, courseCode string) (*CoursePublic, error) {
	row := pool.QueryRow(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
WHERE c.course_code = $1
`, courseCode)
	p, err := scanCoursePublicFromRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// ListForEnrolledUser returns non-archived courses the user is enrolled in, in catalog order (parity with Rust `list_for_enrolled_user`).
// Relative-schedule “materialization” for students is not applied here yet.
func ListForEnrolledUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]CoursePublic, error) {
	rows, err := pool.Query(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
INNER JOIN "user".users ucat ON ucat.id = $1 AND ucat.org_id = c.org_id
LEFT JOIN course.user_course_catalog_order o
  ON o.user_id = $1 AND o.course_id = c.id
WHERE c.id IN (SELECT e.course_id FROM course.course_enrollments e WHERE e.user_id = $1 AND e.active)
  AND c.archived = false
ORDER BY o.sort_order NULLS LAST, c.title ASC
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CoursePublic
	for rows.Next() {
		p, err := scanCoursePublicFromRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListForEnrolledUserInOrgUnits returns enrolled courses whose org_unit_id is in allowed (non-null only).
func ListForEnrolledUserInOrgUnits(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, allowed []uuid.UUID) ([]CoursePublic, error) {
	if len(allowed) == 0 {
		return []CoursePublic{}, nil
	}
	rows, err := pool.Query(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
INNER JOIN "user".users ucat ON ucat.id = $1 AND ucat.org_id = c.org_id
LEFT JOIN course.user_course_catalog_order o
  ON o.user_id = $1 AND o.course_id = c.id
WHERE c.id IN (SELECT e.course_id FROM course.course_enrollments e WHERE e.user_id = $1 AND e.active)
  AND c.archived = false
  AND c.org_unit_id IS NOT NULL
  AND c.org_unit_id = ANY($2::uuid[])
ORDER BY o.sort_order NULLS LAST, c.title ASC
`, userID, allowed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CoursePublic
	for rows.Next() {
		p, err := scanCoursePublicFromRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListForEnrolledUserByTerm filters enrolled courses by term_id (must belong to user's org).
func ListForEnrolledUserByTerm(ctx context.Context, pool *pgxpool.Pool, userID, termID uuid.UUID) ([]CoursePublic, error) {
	rows, err := pool.Query(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
INNER JOIN "user".users ucat ON ucat.id = $1 AND ucat.org_id = c.org_id
LEFT JOIN course.user_course_catalog_order o
  ON o.user_id = $1 AND o.course_id = c.id
WHERE c.id IN (SELECT e.course_id FROM course.course_enrollments e WHERE e.user_id = $1 AND e.active)
  AND c.archived = false
  AND c.term_id = $2
ORDER BY o.sort_order NULLS LAST, c.title ASC
`, userID, termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CoursePublic
	for rows.Next() {
		p, err := scanCoursePublicFromRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListForEnrolledUserInOrgUnitsByTerm is ListForEnrolledUserInOrgUnits with term filter.
func ListForEnrolledUserInOrgUnitsByTerm(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, allowed []uuid.UUID, termID uuid.UUID) ([]CoursePublic, error) {
	if len(allowed) == 0 {
		return []CoursePublic{}, nil
	}
	rows, err := pool.Query(ctx, `
SELECT`+coursePublicSelect+coursePublicFrom+`
INNER JOIN "user".users ucat ON ucat.id = $1 AND ucat.org_id = c.org_id
LEFT JOIN course.user_course_catalog_order o
  ON o.user_id = $1 AND o.course_id = c.id
WHERE c.id IN (SELECT e.course_id FROM course.course_enrollments e WHERE e.user_id = $1 AND e.active)
  AND c.archived = false
  AND c.org_unit_id IS NOT NULL
  AND c.org_unit_id = ANY($2::uuid[])
  AND c.term_id = $3
ORDER BY o.sort_order NULLS LAST, c.title ASC
`, userID, allowed, termID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CoursePublic
	for rows.Next() {
		p, err := scanCoursePublicFromRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func nullTimePtr(n sql.NullTime) *time.Time {
	if !n.Valid {
		return nil
	}
	t := n.Time
	return &t
}
