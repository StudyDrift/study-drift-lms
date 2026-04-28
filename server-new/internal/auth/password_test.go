package auth

import (
	"testing"
)

func TestHashPassword_VerifyPassword(t *testing.T) {
	t.Parallel()
	p := "a-longer-secret"
	h, err := HashPassword(p)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := VerifyPassword(p, h)
	if err != nil || !ok {
		t.Fatalf("verify own hash: ok=%v err=%v", ok, err)
	}
	ok, err = VerifyPassword("nope", h)
	if err != nil || ok {
		t.Fatalf("wrong password: ok=%v err=%v", ok, err)
	}
}

func TestVerifyPassword_WrongString(t *testing.T) {
	t.Parallel()
	ok, err := VerifyPassword("x", "not-a-phc")
	if err == nil && ok {
		t.Fatal("expected failure for garbage hash")
	}
}
