package coursestructure

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ItemRow matches `server/src/models/course_structure::CourseStructureItemRow`.
type ItemRow struct {
	ID                uuid.UUID
	CourseID          uuid.UUID
	SortOrder         int
	Kind              string
	Title             string
	ParentID          *uuid.UUID
	Published         bool
	VisibleFrom       *time.Time
	Archived          bool
	DueAt             *time.Time
	AssignmentGroupID *uuid.UUID
	BlueprintLocked   bool
	BlueprintOriginID *uuid.UUID
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// ItemResponse is the JSON body for a structure item (camelCase, parity with Rust `CourseStructureItemResponse`).
type ItemResponse struct {
	ID                string     `json:"id"`
	SortOrder         int        `json:"sortOrder"`
	Kind              string     `json:"kind"`
	Title             string     `json:"title"`
	ParentID          *string    `json:"parentId"`
	Published         bool       `json:"published"`
	VisibleFrom       *time.Time `json:"visibleFrom"`
	Archived          bool       `json:"archived"`
	DueAt             *time.Time `json:"dueAt"`
	AssignmentGroupID *string    `json:"assignmentGroupId"`
	BlueprintLocked   bool       `json:"blueprintLocked"`
	BlueprintOriginID *string    `json:"blueprintOriginId,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	IsAdaptive        *bool      `json:"isAdaptive,omitempty"`
	PointsPossible    *int       `json:"pointsPossible,omitempty"`
	PointsWorth       *int       `json:"pointsWorth,omitempty"`
	ExternalURL       *string    `json:"externalUrl,omitempty"`
}

var selectItemRow = `SELECT
    c.id, c.course_id, c.sort_order, c.kind, c.title, c.parent_id, c.published, c.visible_from, c.archived, c.due_at, c.assignment_group_id, c.blueprint_locked, c.blueprint_origin_id, c.created_at, c.updated_at
    FROM course.course_structure_items c`

// ListForCourse loads and orders structure rows (top-level, then each module’s children) for one course.
func ListForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]ItemRow, error) {
	rows, err := pool.Query(ctx, selectItemRow+` WHERE c.course_id = $1`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ItemRow
	for rows.Next() {
		var r ItemRow
		if err := rows.Scan(
			&r.ID, &r.CourseID, &r.SortOrder, &r.Kind, &r.Title, &r.ParentID, &r.Published, &r.VisibleFrom, &r.Archived, &r.DueAt, &r.AssignmentGroupID, &r.BlueprintLocked, &r.BlueprintOriginID, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return OrderRows(out), nil
}

// OrderRows returns top-level items by sort order, then each module’s child rows in order (Rust `order_structure_rows`).
func OrderRows(rows []ItemRow) []ItemRow {
	var top []ItemRow
	for i := range rows {
		if rows[i].ParentID == nil {
			top = append(top, rows[i])
		}
	}
	sort.Slice(top, func(i, j int) bool { return top[i].SortOrder < top[j].SortOrder })

	out := make([]ItemRow, 0, len(rows))
	for _, row := range top {
		out = append(out, row)
		if row.Kind != "module" {
			continue
		}
		var child []ItemRow
		for i := range rows {
			if rows[i].ParentID != nil && *rows[i].ParentID == row.ID {
				child = append(child, rows[i])
			}
		}
		sort.Slice(child, func(i, j int) bool { return child[i].SortOrder < child[j].SortOrder })
		out = append(out, child...)
	}
	return out
}

// FilterArchivedItems removes archived rows and children of archived modules (Rust `filter_archived_items_from_structure_list`).
func FilterArchivedItems(rows []ItemRow) []ItemRow {
	archivedMod := make(map[uuid.UUID]struct{})
	for i := range rows {
		if rows[i].Kind == "module" && rows[i].Archived {
			archivedMod[rows[i].ID] = struct{}{}
		}
	}
	out := make([]ItemRow, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		if r.Archived {
			continue
		}
		if r.ParentID != nil {
			if _, ok := archivedMod[*r.ParentID]; ok {
				continue
			}
		}
		out = append(out, *r)
	}
	return out
}

// FilterStructureForStudentView keeps only modules/children visible to enrolled students (not staff preview).
// Rust `filter_structure_for_student_view`.
func FilterStructureForStudentView(rows []ItemRow, now time.Time) []ItemRow {
	utc := now.UTC()
	modules := make(map[uuid.UUID]ItemRow)
	for i := range rows {
		if rows[i].Kind == "module" && rows[i].ParentID == nil {
			modules[rows[i].ID] = rows[i]
		}
	}
	out := make([]ItemRow, 0, len(rows))
	for i := range rows {
		r := rows[i]
		if r.Kind == "module" && r.ParentID == nil {
			if moduleVisibleToStudent(&r, utc) {
				out = append(out, r)
			}
			continue
		}
		if r.ParentID == nil {
			out = append(out, r)
			continue
		}
		if m, ok := modules[*r.ParentID]; ok {
			if moduleVisibleToStudent(&m, utc) && r.Published && !r.Archived {
				out = append(out, r)
			}
		}
	}
	return out
}

func moduleVisibleToStudent(m *ItemRow, now time.Time) bool {
	if m.Kind != "module" || !m.Published || m.Archived {
		return false
	}
	if m.VisibleFrom == nil {
		return true
	}
	return !m.VisibleFrom.After(now)
}

// BaseItemResponse maps a row to API fields before quiz/assignment enrichment.
func BaseItemResponse(r ItemRow) ItemResponse {
	resp := ItemResponse{
		ID:                r.ID.String(),
		SortOrder:         r.SortOrder,
		Kind:              r.Kind,
		Title:             r.Title,
		ParentID:          uuidStringPtr(r.ParentID),
		Published:         r.Published,
		VisibleFrom:       r.VisibleFrom,
		Archived:          r.Archived,
		DueAt:             r.DueAt,
		AssignmentGroupID: uuidStringPtr(r.AssignmentGroupID),
		BlueprintLocked:   r.BlueprintLocked,
		BlueprintOriginID: uuidStringPtr(r.BlueprintOriginID),
		CreatedAt:         r.CreatedAt,
		UpdatedAt:         r.UpdatedAt,
	}
	return resp
}

func uuidStringPtr(u *uuid.UUID) *string {
	if u == nil {
		return nil
	}
	s := u.String()
	return &s
}

// QuizOutline is per-quiz data for list responses (Rust `QuizStructureListOutline`).
type QuizOutline struct {
	IsAdaptive          bool
	QuestionPointsTotal int
	PointsWorth         *int
}

// LoadQuizOutlines fetches is_adaptive, points sum from questions_json, and points_worth for quiz items.
func LoadQuizOutlines(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, quizIDs []uuid.UUID) (map[uuid.UUID]QuizOutline, error) {
	out := make(map[uuid.UUID]QuizOutline)
	if len(quizIDs) == 0 {
		return out, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT
			c.id,
			m.is_adaptive,
			COALESCE((
				SELECT SUM((elem->>'points')::int)
				FROM jsonb_array_elements(m.questions_json) AS elem
			), 0)::int,
			m.points_worth
		FROM course.course_structure_items c
		INNER JOIN course.module_quizzes m ON m.structure_item_id = c.id
		WHERE c.course_id = $1 AND c.kind = 'quiz' AND c.id = ANY($2)
	`, courseID, quizIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var isAdaptive bool
		var qTotal int
		var pointsWorth *int
		if err := rows.Scan(&id, &isAdaptive, &qTotal, &pointsWorth); err != nil {
			return nil, err
		}
		var pwCopy *int
		if pointsWorth != nil {
			v := *pointsWorth
			pwCopy = &v
		}
		out[id] = QuizOutline{IsAdaptive: isAdaptive, QuestionPointsTotal: qTotal, PointsWorth: pwCopy}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// LoadAssignmentPointsWorth returns points_worth for assignment items.
func LoadAssignmentPointsWorth(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, assignIDs []uuid.UUID) (map[uuid.UUID]*int, error) {
	out := make(map[uuid.UUID]*int)
	if len(assignIDs) == 0 {
		return out, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT c.id, m.points_worth
		FROM course.course_structure_items c
		INNER JOIN course.module_assignments m ON m.structure_item_id = c.id
		WHERE c.course_id = $1 AND c.kind = 'assignment' AND c.id = ANY($2)
	`, courseID, assignIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var pointsWorth *int
		if err := rows.Scan(&id, &pointsWorth); err != nil {
			return nil, err
		}
		if pointsWorth == nil {
			continue
		}
		v := *pointsWorth
		vv := v
		out[id] = &vv
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// LoadExternalURLs returns url for external_link items.
func LoadExternalURLs(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, extIDs []uuid.UUID) (map[uuid.UUID]string, error) {
	out := make(map[uuid.UUID]string)
	if len(extIDs) == 0 {
		return out, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT c.id, m.url
		FROM course.course_structure_items c
		INNER JOIN course.module_external_links m ON m.structure_item_id = c.id
		WHERE c.course_id = $1 AND c.kind = 'external_link' AND c.id = ANY($2)
	`, courseID, extIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var url string
		if err := rows.Scan(&id, &url); err != nil {
			return nil, err
		}
		out[id] = url
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// RowsToResponsesWithQuizAdaptive maps rows to API items, including quiz/assignment/external fields (Rust `rows_to_responses_with_quiz_adaptive`).
func RowsToResponsesWithQuizAdaptive(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, rows []ItemRow) ([]ItemResponse, error) {
	quizIDs := make([]uuid.UUID, 0)
	assignIDs := make([]uuid.UUID, 0)
	extIDs := make([]uuid.UUID, 0)
	for i := range rows {
		switch rows[i].Kind {
		case "quiz":
			quizIDs = append(quizIDs, rows[i].ID)
		case "assignment":
			assignIDs = append(assignIDs, rows[i].ID)
		case "external_link":
			extIDs = append(extIDs, rows[i].ID)
		}
	}
	quizOut, err := LoadQuizOutlines(ctx, pool, courseID, quizIDs)
	if err != nil {
		return nil, err
	}
	apw, err := LoadAssignmentPointsWorth(ctx, pool, courseID, assignIDs)
	if err != nil {
		return nil, err
	}
	ext, err := LoadExternalURLs(ctx, pool, courseID, extIDs)
	if err != nil {
		return nil, err
	}
	out := make([]ItemResponse, 0, len(rows))
	for i := range rows {
		item := BaseItemResponse(rows[i])
		switch item.Kind {
		case "quiz":
			if o, ok := quizOut[rows[i].ID]; ok {
				ia := o.IsAdaptive
				item.IsAdaptive = &ia
				if o.PointsWorth != nil {
					pw := *o.PointsWorth
					item.PointsWorth = &pw
				}
				if !o.IsAdaptive {
					pp := o.QuestionPointsTotal
					item.PointsPossible = &pp
				}
			} else {
				f := false
				z := 0
				item.IsAdaptive = &f
				item.PointsPossible = &z
			}
		case "assignment":
			if p, ok := apw[rows[i].ID]; ok {
				pCopy := *p
				item.PointsWorth = &pCopy
			}
		case "external_link":
			if u, ok := ext[rows[i].ID]; ok && u != "" {
				item.ExternalURL = &u
			}
		}
		out = append(out, item)
	}
	return out, nil
}

// ListForCourseWithEnrichment loads, filters, and enriches structure for GET /api/v1/courses/…/structure.
// If staffView is true, does not apply student-only visibility. Relative schedule and competency gating are not yet ported.
func ListForCourseWithEnrichment(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, staffView bool) ([]ItemResponse, error) {
	rows, err := ListForCourse(ctx, pool, courseID)
	if err != nil {
		return nil, err
	}
	rows = FilterArchivedItems(rows)
	if !staffView {
		rows = FilterStructureForStudentView(rows, time.Now().UTC())
		// future: apply relative schedule row shifts and competency gating (see Rust `structure_list_handler`)
	}
	return RowsToResponsesWithQuizAdaptive(ctx, pool, courseID, rows)
}

// GetItemRow returns one structure row in a course (Rust `get_item_row`).
func GetItemRow(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) (*ItemRow, error) {
	var r ItemRow
	err := pool.QueryRow(ctx, selectItemRow+` WHERE c.course_id = $1 AND c.id = $2`, courseID, itemID).Scan(
		&r.ID, &r.CourseID, &r.SortOrder, &r.Kind, &r.Title, &r.ParentID, &r.Published, &r.VisibleFrom, &r.Archived, &r.DueAt, &r.AssignmentGroupID, &r.BlueprintLocked, &r.BlueprintOriginID, &r.CreatedAt, &r.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}
