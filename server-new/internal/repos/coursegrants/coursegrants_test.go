package coursegrants

import "testing"

func TestExpandAndPlaceholder(t *testing.T) {
	t.Parallel()
	s, ok := ExpandCoursePermissionForCourse("course:<courseCode>:gradebook:view", "C-ABC123")
	if !ok || s != "course:C-ABC123:gradebook:view" {
		t.Fatalf("got %q %v", s, ok)
	}
	s, ok = ExpandCoursePermissionForCourse("course:*:item:create", "C-XYZ")
	if !ok || s != "course:C-XYZ:item:create" {
		t.Fatalf("star: got %q", s)
	}
	if !IsCoursePermissionWithPlaceholderToken("course:<courseCode>:gradebook:view") {
		t.Fatal("placeholder")
	}
	if IsCoursePermissionWithPlaceholderToken("course:C-1:gradebook:view") {
		t.Fatal("concrete not placeholder")
	}
}

func TestCourseEnrollmentsReadPermission(t *testing.T) {
	t.Parallel()
	if s := CourseEnrollmentsReadPermission("C-ABC"); s != "course:C-ABC:enrollments:read" {
		t.Fatalf("got %q", s)
	}
}

func TestAddItemsCreateSiblingGrants(t *testing.T) {
	t.Parallel()
	out := map[string]struct{}{
		"course:C-1:item:create":  {},
		"course:C-1:other:read":  {},
	}
	AddItemsCreateSiblingGrants(out)
	if _, ok := out["course:C-1:items:create"]; !ok {
		t.Fatal("missing items:create")
	}
}
