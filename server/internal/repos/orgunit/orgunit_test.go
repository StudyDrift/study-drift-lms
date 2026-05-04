package orgunit

import (
	"testing"

	"github.com/google/uuid"
)

func TestBuildTree_nested(t *testing.T) {
	org := uuid.New()
	rootID := uuid.New()
	childID := uuid.New()
	rows := []Row{
		{ID: childID, OrgID: org, ParentUnitID: &rootID, Name: "Math", UnitType: "department", Status: "active"},
		{ID: rootID, OrgID: org, ParentUnitID: nil, Name: "Lincoln", UnitType: "school", Status: "active"},
	}
	tree := BuildTree(rows)
	if len(tree) != 1 {
		t.Fatalf("roots: %d", len(tree))
	}
	if tree[0].Name != "Lincoln" {
		t.Fatalf("root name: %q", tree[0].Name)
	}
	if len(tree[0].Children) != 1 || tree[0].Children[0].Name != "Math" {
		t.Fatalf("children: %+v", tree[0].Children)
	}
}
