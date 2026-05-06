package coursestructure

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestItemResponseFromRow(t *testing.T) {
	now := time.Now()
	parent := uuid.New()
	due := now.Add(time.Hour)
	visible := now.Add(time.Minute)
	group := uuid.New()
	row := CourseStructureItemRow{
		ID:                uuid.New(),
		CourseID:          uuid.New(),
		SortOrder:         5,
		Kind:              "module",
		Title:             "Module 1",
		ParentID:          &parent,
		Published:         true,
		VisibleFrom:       &visible,
		Archived:          false,
		DueAt:             &due,
		AssignmentGroupID: &group,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	resp := ItemResponseFromRow(row)
	if resp.ID != row.ID || resp.SortOrder != 5 || resp.Kind != "module" {
		t.Fatalf("mismatch: %+v", resp)
	}
	if resp.ParentID == nil || *resp.ParentID != parent {
		t.Fatal("parent")
	}
	if resp.DueAt == nil || !resp.DueAt.Equal(due) {
		t.Fatal("dueAt")
	}
	if resp.VisibleFrom == nil || !resp.VisibleFrom.Equal(visible) {
		t.Fatal("visibleFrom")
	}
	if resp.AssignmentGroupID == nil || *resp.AssignmentGroupID != group {
		t.Fatal("group")
	}
	if !resp.CreatedAt.Equal(now) {
		t.Fatal("created")
	}
}
