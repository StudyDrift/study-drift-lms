package apierr

import (
	"encoding/json"
	"net/http"
)

// WritePasswordPolicyViolation writes RFC 7807-style problem+json for password policy failures (422).
func WritePasswordPolicyViolation(w http.ResponseWriter, detail string, violations []string) {
	w.Header().Set("Content-Type", "application/problem+json; charset=utf-8")
	w.WriteHeader(http.StatusUnprocessableEntity)
	_ = json.NewEncoder(w).Encode(struct {
		Type        string   `json:"type"`
		Title       string   `json:"title"`
		Status      int      `json:"status"`
		Detail      string   `json:"detail"`
		Violations  []string `json:"violations"`
	}{
		Type:       "password_policy_violation",
		Title:      "Password policy violation",
		Status:     422,
		Detail:     detail,
		Violations: violations,
	})
}
