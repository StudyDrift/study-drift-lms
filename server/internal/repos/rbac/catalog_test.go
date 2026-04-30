package rbac

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestIsUniqueViolation(t *testing.T) {
	e := &pgconn.PgError{Code: "23505"}
	if !IsUniqueViolation(e) {
		t.Fatal("expected 23505 as unique")
	}
	if IsUniqueViolation(errors.New("other")) {
		t.Fatal("unexpected")
	}
	if IsUniqueViolation(nil) {
		t.Fatal("nil")
	}
}
