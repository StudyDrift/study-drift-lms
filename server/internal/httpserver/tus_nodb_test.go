package httpserver

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Auth guard tests — no DB or storage needed.
// ---------------------------------------------------------------------------

func TestTusCreate_NoJWT_Returns401(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/tus/files", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 got %d", rr.Code)
	}
}

func TestTusHead_NoJWT_Returns401(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodHead, "/api/v1/tus/files/00000000-0000-0000-0000-000000000001", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 got %d", rr.Code)
	}
}

func TestTusPatch_NoJWT_Returns401(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/tus/files/00000000-0000-0000-0000-000000000001", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 got %d", rr.Code)
	}
}

func TestTusDelete_NoJWT_Returns401(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodDelete, "/api/v1/tus/files/00000000-0000-0000-0000-000000000001", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 got %d", rr.Code)
	}
}

// ---------------------------------------------------------------------------
// Metadata parser tests.
// ---------------------------------------------------------------------------

func TestParseTusMetadata_Empty(t *testing.T) {
	m := parseTusMetadata("")
	if len(m) != 0 {
		t.Fatalf("expected empty map, got %v", m)
	}
}

func TestParseTusMetadata_SingleKey(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("video.mp4"))
	m := parseTusMetadata("filename " + encoded)
	if m["filename"] != "video.mp4" {
		t.Fatalf("expected 'video.mp4', got %q", m["filename"])
	}
}

func TestParseTusMetadata_MultipleKeys(t *testing.T) {
	fname := base64.StdEncoding.EncodeToString([]byte("lecture.mp4"))
	ftype := base64.StdEncoding.EncodeToString([]byte("video/mp4"))
	header := "filename " + fname + ",filetype " + ftype
	m := parseTusMetadata(header)
	if m["filename"] != "lecture.mp4" {
		t.Fatalf("filename: got %q", m["filename"])
	}
	if m["filetype"] != "video/mp4" {
		t.Fatalf("filetype: got %q", m["filetype"])
	}
}

func TestParseTusMetadata_InvalidBase64Skipped(t *testing.T) {
	m := parseTusMetadata("filename !!!invalid!!!")
	if _, ok := m["filename"]; ok {
		t.Fatalf("expected key 'filename' to be absent due to invalid base64")
	}
}

func TestParseTusMetadata_KeyWithNoValue(t *testing.T) {
	m := parseTusMetadata("somekey")
	if m["somekey"] != "" {
		t.Fatalf("expected empty string for key with no value, got %q", m["somekey"])
	}
}

// ---------------------------------------------------------------------------
// Tus response header helper.
// ---------------------------------------------------------------------------

func TestAddTusHeaders(t *testing.T) {
	rr := httptest.NewRecorder()
	addTusHeaders(rr)
	if rr.Header().Get("Tus-Resumable") != tusVersion {
		t.Fatalf("Tus-Resumable: got %q", rr.Header().Get("Tus-Resumable"))
	}
	if !strings.Contains(rr.Header().Get("Tus-Extension"), "creation") {
		t.Fatalf("Tus-Extension should include 'creation': got %q", rr.Header().Get("Tus-Extension"))
	}
	if !strings.Contains(rr.Header().Get("Tus-Extension"), "termination") {
		t.Fatalf("Tus-Extension should include 'termination': got %q", rr.Header().Get("Tus-Extension"))
	}
}

// ---------------------------------------------------------------------------
// Mime allowlist.
// ---------------------------------------------------------------------------

func TestTusMimeAllowlist(t *testing.T) {
	for _, mime := range []string{"video/mp4", "image/jpeg", "application/pdf", "application/octet-stream"} {
		if !tusMimeAllowlist[mime] {
			t.Errorf("expected %q to be in allowlist", mime)
		}
	}
	for _, mime := range []string{"application/x-executable", "text/html", "application/javascript"} {
		if tusMimeAllowlist[mime] {
			t.Errorf("expected %q NOT to be in allowlist", mime)
		}
	}
}

// ---------------------------------------------------------------------------
// Temp path.
// ---------------------------------------------------------------------------

func TestTusTempPath_ContainsUploadID(t *testing.T) {
	id := uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")
	p := tusTempPath(id)
	if !strings.Contains(p, id.String()) {
		t.Fatalf("expected temp path to contain upload id, got %q", p)
	}
	if !strings.HasSuffix(p, ".part") {
		t.Fatalf("expected temp path to end in .part, got %q", p)
	}
}
