// Package apierr serializes client-facing errors in the same shape as the legacy Rust API.
package apierr

import (
	"encoding/json"
	"net/http"
)

// API error code strings (JSON "error.code"); messages stay human-readable.
const (
	CodeInvalidInput       = "INVALID_INPUT"
	CodeInvalidCredentials = "INVALID_CREDENTIALS"
	CodeEmailTaken         = "EMAIL_TAKEN"
	CodeInvalidResetToken  = "INVALID_RESET_TOKEN"
	CodeMagicLinkGone       = "MAGIC_LINK_GONE"
	CodeRateLimited         = "RATE_LIMITED"
	CodeUnauthorized       = "UNAUTHORIZED"
	CodeNotFound            = "NOT_FOUND"
	// CodeNotImplementedInGo: no chi route; path still on Rust in migration.
	CodeNotImplementedInGo = "NOT_IMPLEMENTED_IN_GO"
	CodeUnknownCourseCode  = "UNKNOWN_COURSE_CODE"
	CodeForbidden          = "FORBIDDEN"
	CodeConflict           = "CONFLICT"
	CodeMFARequired        = "MFA_REQUIRED"
	CodeMFAEnrolRequired    = "MFA_ENROLMENT_REQUIRED"
	CodeInternal           = "INTERNAL"
	// CodeUnprocessableEntity is used when the request is well-formed but cannot be applied (e.g. revoke current session).
	CodeUnprocessableEntity = "UNPROCESSABLE_ENTITY"
	CodeAiNotConfigured     = "AI_NOT_CONFIGURED"
	CodeAiGenerationFailed  = "AI_GENERATION_FAILED"
	CodeOrgSuspended        = "ORG_SUSPENDED"
)

// Body matches server/src/error.rs JSON error envelope.
type Body struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// WriteJSON writes a JSON error body and sets Content-Type. Status is typically 4xx/5xx.
func WriteJSON(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body(code, message))
}

func body(code, message string) Body {
	var b Body
	b.Error.Code = code
	b.Error.Message = message
	return b
}
