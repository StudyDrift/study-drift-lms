package apierr

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestWritePasswordPolicyViolation(t *testing.T) {
	t.Parallel()
	rr := httptest.NewRecorder()
	WritePasswordPolicyViolation(rr, "Use a longer password.", []string{"password.min_length"})
	if rr.Code != 422 {
		t.Fatalf("status %d", rr.Code)
	}
	var body struct {
		Type       string   `json:"type"`
		Detail     string   `json:"detail"`
		Violations []string `json:"violations"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Type != "password_policy_violation" || body.Detail == "" || len(body.Violations) == 0 {
		t.Fatalf("%+v", body)
	}
}
