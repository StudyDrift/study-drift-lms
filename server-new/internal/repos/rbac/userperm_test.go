package rbac

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestValidatePermissionString(t *testing.T) {
	if err := ValidatePermissionString("global:app:rbac:manage"); err != nil {
		t.Fatalf("ok: %v", err)
	}
	if err := ValidatePermissionString("a:b"); err == nil {
		t.Fatal("expected err")
	}
	if err := ValidatePermissionString("a:b::c"); err == nil {
		t.Fatal("expected err for empty segment")
	}
}

func TestUserHasPermission_UnvalidatedRequired(t *testing.T) {
	_, err := UserHasPermission(context.Background(), nil, uuid.New(), "bad:perm")
	if err == nil {
		t.Fatal("expected validate error before pool use")
	}
}
