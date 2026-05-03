package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/models/search"
)

func TestFilterSearchPeopleByRosterRead(t *testing.T) {
	uid := uuid.New()
	// No course:* wildcard — that grant would include every course in the list.
	grants := []string{"course:ABC:enrollments:read"}
	in := []search.PersonItem{
		{UserID: uid, Email: "a@b", CourseCode: "ABC", CourseTitle: "X", Role: "Student"},
		{UserID: uid, Email: "c@d", CourseCode: "ZZZ", CourseTitle: "Y", Role: "Student"},
	}
	out := filterSearchPeopleByRosterRead(grants, in)
	if len(out) != 1 || out[0].Email != "a@b" {
		t.Fatalf("got %+v", out)
	}
	out2 := filterSearchPeopleByRosterRead(grants, nil)
	if out2 != nil {
		t.Fatalf("nil: %+v", out2)
	}
}

func TestHandleSearchIndex_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestHandleSearchIndex_MethodNotAllowed(t *testing.T) {
	s := auth.NewJWTSigner("01234567890123456789012345678901")
	d := Deps{Pool: nil, JWTSigner: s}
	tok, err := s.Sign(context.Background(), uuid.NewString(), "x@y.com", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/search", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("code: %d", rr.Code)
	}
}
