// Package coursegrants contains pure helpers from server/src/repos/course_grants.rs.
package coursegrants

import "strings"

// CourseCodePlaceholder is the second segment in catalog per-course role grants.
const CourseCodePlaceholder = "<courseCode>"

// IsCoursePermissionWithPlaceholder is true for e.g. course:<courseCode>:gradebook:view.
func IsCoursePermissionWithPlaceholderToken(s string) bool {
	parts := strings.Split(strings.TrimSpace(s), ":")
	return len(parts) == 4 && parts[0] == "course" && parts[1] == CourseCodePlaceholder
}

// ExpandCoursePermissionForCourse builds a concrete course:... permission; returns ("", false) if not a course perm.
func ExpandCoursePermissionForCourse(granted, courseCode string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(granted), ":")
	if len(parts) != 4 || parts[0] != "course" {
		return "", false
	}
	area := parts[1]
	if area == "*" || area == courseCode || area == CourseCodePlaceholder {
		return "course:" + courseCode + ":" + parts[2] + ":" + parts[3], true
	}
	return "", false
}

// CourseEnrollmentsReadPermission is course:{code}:enrollments:read (roster for that course).
func CourseEnrollmentsReadPermission(courseCode string) string {
	return "course:" + courseCode + ":enrollments:read"
}

// CourseItemsCreatePermission is course:{code}:item:create (authoring / bank imports).
func CourseItemsCreatePermission(courseCode string) string {
	return "course:" + courseCode + ":item:create"
}

// AddItemsCreateSiblingGrants for every course:…:item:create, also insert course:…:items:create.
func AddItemsCreateSiblingGrants(out map[string]struct{}) {
	keys := make([]string, 0, len(out))
	for p := range out {
		keys = append(keys, p)
	}
	for _, p := range keys {
		if !strings.HasPrefix(p, "course:") || !strings.HasSuffix(p, ":item:create") {
			continue
		}
		if prefix, ok := strings.CutSuffix(p, ":item:create"); ok {
			out[prefix+":items:create"] = struct{}{}
		}
	}
}
