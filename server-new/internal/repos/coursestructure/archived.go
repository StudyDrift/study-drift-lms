package coursestructure

import (
	"context"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var archivedChildKinds = map[string]struct{}{
	"heading":       {},
	"content_page":  {},
	"assignment":    {},
	"quiz":          {},
	"external_link": {},
	"survey":        {},
	"lti_link":      {},
}

// ListArchivedStaffStructure returns archived module children plus their parent modules (staff-only list).
func ListArchivedStaffStructure(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]ItemRow, error) {
	rows, err := ListForCourse(ctx, pool, courseID)
	if err != nil {
		return nil, err
	}

	modByID := make(map[uuid.UUID]ItemRow)
	childrenByParent := make(map[uuid.UUID][]ItemRow)
	for i := range rows {
		r := rows[i]
		if r.Kind == "module" && r.ParentID == nil {
			modByID[r.ID] = r
			continue
		}
		if !r.Archived || r.ParentID == nil {
			continue
		}
		if _, ok := archivedChildKinds[r.Kind]; !ok {
			continue
		}
		childrenByParent[*r.ParentID] = append(childrenByParent[*r.ParentID], r)
	}

	if len(childrenByParent) == 0 {
		return []ItemRow{}, nil
	}

	type parentAndChildren struct {
		parent   ItemRow
		children []ItemRow
	}
	var groups []parentAndChildren
	for pid, children := range childrenByParent {
		parent, ok := modByID[pid]
		if !ok {
			continue
		}
		sort.Slice(children, func(i, j int) bool { return children[i].SortOrder < children[j].SortOrder })
		groups = append(groups, parentAndChildren{parent: parent, children: children})
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].parent.SortOrder < groups[j].parent.SortOrder })

	out := make([]ItemRow, 0, len(rows))
	for _, g := range groups {
		out = append(out, g.parent)
		out = append(out, g.children...)
	}
	return out, nil
}

