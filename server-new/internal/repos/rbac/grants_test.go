package rbac

import "testing"

func TestFilterGrantsForStudentCourseView_StaffOnlyForThisCourse(t *testing.T) {
	t.Parallel()
	grants := map[string]struct{}{
		"course:C-1:enrollments:read": {},
		"course:C-1:modules:read":    {},
	}
	teacher := []string{"course:<courseCode>:enrollments:read"}
	student := []string{"course:<courseCode>:modules:read"}
	out := filterGrantsForStudentCourseView("C-1", grants, teacher, student)
	if _, ok := out["course:C-1:enrollments:read"]; ok {
		t.Fatal("expected staff-only for this course removed")
	}
	if _, ok := out["course:C-1:modules:read"]; !ok {
		t.Fatal("expected student share kept")
	}
}

func TestFilterGrantsForStudentCourseView_DropsGlobalNotInStudent(t *testing.T) {
	t.Parallel()
	grants := map[string]struct{}{
		"global:app:reports:view":   {},
		"global:app:course:create": {},
	}
	out := filterGrantsForStudentCourseView("C-1", grants, nil, nil)
	if len(out) != 0 {
		t.Fatalf("expected empty, got %d", len(out))
	}
}

func TestFilterGrantsForStudentCourseView_KeepsOtherCourse(t *testing.T) {
	t.Parallel()
	grants := map[string]struct{}{
		"course:C-2:enrollments:read": {},
	}
	teacher := []string{"course:<courseCode>:enrollments:read"}
	var student []string
	out := filterGrantsForStudentCourseView("C-1", grants, teacher, student)
	if _, ok := out["course:C-2:enrollments:read"]; !ok {
		t.Fatal("other course should remain")
	}
}

func TestFilterGrantsForStudentCourseView_KeepsGlobalOnStudentCatalog(t *testing.T) {
	t.Parallel()
	grants := map[string]struct{}{
		"global:app:custom:thing": {},
	}
	var teacher []string
	student := []string{"global:app:custom:thing"}
	out := filterGrantsForStudentCourseView("C-1", grants, teacher, student)
	if _, ok := out["global:app:custom:thing"]; !ok {
		t.Fatal("global in student role kept")
	}
}

func TestCourseRoleCatalogMatchesConcrete(t *testing.T) {
	t.Parallel()
	catalog := []string{"global:app:course:create"}
	if courseRoleCatalogMatchesConcrete(catalog, "course:C-1:enrollments:read", "C-1") {
		t.Fatal("unrelated global should not match course perm")
	}
}
