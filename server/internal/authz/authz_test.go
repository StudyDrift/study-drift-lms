package authz

import "testing"

func TestPermissionMatches(t *testing.T) {
	t.Parallel()
	if !PermissionMatches("course:C-6:enrollments:create", "course:C-6:enrollments:create") {
		t.Fatal("exact")
	}
	if !PermissionMatches("course:*:enrollments:create", "course:C-6:enrollments:create") {
		t.Fatal("wildcard granted")
	}
	if PermissionMatches("course:*:enrollments:read", "course:*:enrollments:create") {
		t.Fatal("mismatch")
	}
	if !PermissionMatches("a:b:c:d", "a:b:c:d") {
		t.Fatal("four parts")
	}
}

func TestAnyGrantMatch(t *testing.T) {
	t.Parallel()
	if !AnyGrantMatch([]string{"x:1:2:3", "a:*:c:d"}, "a:b:c:d") {
		t.Fatal("any")
	}
	if AnyGrantMatch(nil, "a:b:c:d") {
		t.Fatal("nil grants")
	}
	if AnyGrantMatch([]string{"x:1:2:3"}, "a:b:c:d") {
		t.Fatal("no match")
	}
}

func TestPermissionMatches_BadShape(t *testing.T) {
	t.Parallel()
	if PermissionMatches("a:b:c", "a:b:c:d") {
		t.Fatal("3 parts granted")
	}
	if PermissionMatches("a:b:c:d", "a:b:c") {
		t.Fatal("3 parts required")
	}
	if PermissionMatches("", "") {
		t.Fatal("empty")
	}
	if !PermissionMatches("  a:b:c:d  ", "a:b:c:d") {
		t.Fatal("trim")
	}
	if !PermissionMatches("a:b:c:d", "*:*:*:*") {
		t.Fatal("required all wild")
	}
}
