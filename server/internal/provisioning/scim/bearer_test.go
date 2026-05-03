package scim

import "testing"

func TestTrimBearer(t *testing.T) {
	if trimBearer(" abc ") != "abc" {
		t.Fatalf("trim space: %q", trimBearer(" abc "))
	}
	if trimBearer("Bearer tok") != "tok" {
		t.Fatalf("trim scheme: %q", trimBearer("Bearer tok"))
	}
	if trimBearer("bearer lowercase") != "lowercase" {
		t.Fatalf("lower scheme: %q", trimBearer("bearer lowercase"))
	}
}
