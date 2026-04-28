package apierr

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestWriteJSON(t *testing.T) {
	t.Parallel()
	rr := httptest.NewRecorder()
	WriteJSON(rr, 400, CodeInvalidInput, "bad")
	if rr.Code != 400 {
		t.Fatalf("status: %d", rr.Code)
	}
	var b Body
	if err := json.NewDecoder(rr.Body).Decode(&b); err != nil {
		t.Fatal(err)
	}
	if b.Error.Code != CodeInvalidInput || b.Error.Message != "bad" {
		t.Fatalf("body: %#v", b)
	}
}

func TestWriteJSON_Forbidden(t *testing.T) {
	t.Parallel()
	rr := httptest.NewRecorder()
	WriteJSON(rr, 403, CodeForbidden, "You do not have permission for this action.")
	if rr.Code != 403 {
		t.Fatalf("status: %d", rr.Code)
	}
	var b Body
	if err := json.NewDecoder(rr.Body).Decode(&b); err != nil {
		t.Fatal(err)
	}
	if b.Error.Code != CodeForbidden {
		t.Fatalf("code: %q", b.Error.Code)
	}
}
