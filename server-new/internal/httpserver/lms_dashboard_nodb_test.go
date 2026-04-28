package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLMSDashboard_learnersStillUnimplementedForOtherPaths(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/learners/abc/xyz", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("unrelated learners path: %d", rr.Code)
	}
}

func TestLMSDashboard_courseStructureUnauthorizedWithoutJWT(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/courses/C-TEST/structure", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("structure: %d", rr.Code)
	}
}

func TestLMSDashboard_syllabusAcceptanceStatusUnauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/courses/C-TEST/syllabus/acceptance-status", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("syllabus acceptance: %d", rr.Code)
	}
}

func TestLMSDashboard_getSyllabusUnauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/courses/C-TEST/syllabus", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("get syllabus: %d", rr.Code)
	}
}

func TestLMSDashboard_syllabusMarkupsUnauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/courses/C-TEST/syllabus/markups", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("syllabus markups: %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestLMSDashboard_feedRosterUnauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/courses/C-TEST/feed/roster", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("feed roster: %d", rr.Code)
	}
}
