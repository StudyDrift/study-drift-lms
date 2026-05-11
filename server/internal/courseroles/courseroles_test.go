package courseroles

import (
	"testing"

	"github.com/lextures/lextures/server/internal/repos/coursegrants"
)

func TestRoleMatrixPermissions(t *testing.T) {
	code := "C-TEST1"
	ta := RoleMatrixPermissions(code, "ta")
	if len(ta) != 2 {
		t.Fatalf("ta: got %d perms", len(ta))
	}
	designer := RoleMatrixPermissions(code, "designer")
	if len(designer) != 2 {
		t.Fatalf("designer: got %d perms", len(designer))
	}
	p := "course:" + code + ":"
	if !contains(ta, p+"gradebook:view") || contains(ta, p+"item:create") {
		t.Fatalf("unexpected ta matrix: %v", ta)
	}
	if !contains(designer, p+"item:create") || contains(designer, p+"gradebook:view") {
		t.Fatalf("unexpected designer matrix: %v", designer)
	}
}

func contains(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

func TestParseConcreteCoursePermission(t *testing.T) {
	cc, ok := ParseConcreteCoursePermission("course:C-1:gradebook:view")
	if !ok || cc != "C-1" {
		t.Fatalf("got %q %v", cc, ok)
	}
	if _, ok := ParseConcreteCoursePermission("course:*:gradebook:view"); ok {
		t.Fatal("expected wildcard to be non-concrete")
	}
	if _, ok := ParseConcreteCoursePermission("course:" + coursegrants.CourseCodePlaceholder + ":gradebook:view"); ok {
		t.Fatal("expected placeholder to be non-concrete")
	}
}

func TestIsExtendedStaffRole(t *testing.T) {
	if !IsExtendedStaffRole("TA") {
		t.Fatal("TA")
	}
	if IsExtendedStaffRole("teacher") {
		t.Fatal("teacher")
	}
}
