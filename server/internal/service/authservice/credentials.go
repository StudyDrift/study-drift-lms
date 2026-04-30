// Package authservice ports server/src/services/auth/credentials.rs.
package authservice

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/lextures/lextures/server/internal/apierr"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	pauth "github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/mail"
	"github.com/lextures/lextures/server/internal/repos/communication"
	"github.com/lextures/lextures/server/internal/repos/passwordcreditevents"
	"github.com/lextures/lextures/server/internal/repos/passwordreset"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"

	"github.com/lextures/lextures/server/internal/auth/hibp"
)

// LoginRequest mirrors models/auth LoginRequest.
type LoginRequest struct {
	Email    string
	Password string
}

// SignupRequest mirrors models/auth SignupRequest.
type SignupRequest struct {
	Email       string
	Password    string
	DisplayName *string
}

// UserPublic is the API user (camelCase at the HTTP layer).
type UserPublic struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	DisplayName *string `json:"displayName"`
	FirstName   *string `json:"firstName"`
	LastName    *string `json:"lastName"`
	AvatarURL   *string `json:"avatarUrl"`
	UITheme     string  `json:"uiTheme"`
	Sid         *string `json:"sid"`
}

// AuthResponse mirrors models/auth AuthResponse (field names are snake_case like the Rust `AuthResponse` struct).
type AuthResponse struct {
	AccessToken string     `json:"access_token"`
	TokenType   string     `json:"token_type"`
	User        UserPublic `json:"user"`
}

// ForgotPasswordRequest .
type ForgotPasswordRequest struct{ Email string }

// ForgotPasswordResponse .
type ForgotPasswordResponse struct{ Message string }

// ResetPasswordRequest .
type ResetPasswordRequest struct {
	Token    string
	Password string
}

// ResetPasswordResponse .
type ResetPasswordResponse struct{ Message string }

// ChangePasswordRequest is authenticated password rotation.
type ChangePasswordRequest struct {
	CurrentPassword string
	NewPassword     string
}

// ChangePasswordResponse .
type ChangePasswordResponse struct{ Message string }

// ErrInvalidCredentials is returned for bad login.
var ErrInvalidCredentials = errors.New("invalid credentials")

// ErrEmailTaken is a unique email violation.
var ErrEmailTaken = errors.New("email taken")

// FieldError is client-facing input validation.
type FieldError struct{ Message string }

func (e FieldError) Error() string { return e.Message }

// Login .
func Login(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, req LoginRequest) (AuthResponse, error) {
	if err := validateLogin(&req); err != nil {
		return AuthResponse{}, err
	}
	email := user.NormalizeEmail(req.Email)
	row, err := user.FindByEmail(ctx, pool, email)
	if err != nil {
		return AuthResponse{}, err
	}
	if row == nil {
		return AuthResponse{}, ErrInvalidCredentials
	}
	if row.LoginBlocked {
		return AuthResponse{}, ErrInvalidCredentials
	}
	ok, err := pauth.VerifyPassword(req.Password, row.PasswordHash)
	if err != nil || !ok {
		return AuthResponse{}, ErrInvalidCredentials
	}
	return responseFromRow(jwt, row)
}

// Signup .
func Signup(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, checker hibp.Checker, req SignupRequest) (AuthResponse, error) {
	if err := validateSignup(&req); err != nil {
		return AuthResponse{}, err
	}
	hibpRes, err := enforceNewPassword(ctx, pool, nil, req.Password, checker)
	if err != nil {
		return AuthResponse{}, err
	}
	email := user.NormalizeEmail(req.Email)
	ph, err := pauth.HashPassword(req.Password)
	if err != nil {
		return AuthResponse{}, err
	}
	dn := trimStringPtr(req.DisplayName)

	row, err := user.InsertUser(ctx, pool, email, ph, dn)
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			return AuthResponse{}, ErrEmailTaken
		}
		return AuthResponse{}, err
	}
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		return AuthResponse{}, err
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, uid, "Teacher"); err != nil {
		return AuthResponse{}, err
	}
	_ = passwordcreditevents.Insert(ctx, pool, uid, passwordcreditevents.KindSignup, hibpRes.BreachFound, hibpRes.HIBPAvailable)
	communication.SendWelcomeMessage(ctx, pool, email)
	return responseFromRow(jwt, row)
}

// RequestPasswordReset always returns the same public message; persists token when user exists.
func RequestPasswordReset(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, email string) (ForgotPasswordResponse, error) {
	e := user.NormalizeEmail(email)
	if e == "" || !containsAt(e) || len(e) > 254 {
		return ForgotPasswordResponse{}, FieldError{Message: "Enter a valid email address."}
	}
	row, err := user.FindByEmail(ctx, pool, e)
	if err != nil {
		return ForgotPasswordResponse{}, err
	}
	if row == nil {
		return forgotMsg(), nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return ForgotPasswordResponse{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	h := sha256.Sum256([]byte(token))
	exp := time.Now().UTC().Add(time.Hour)
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		return ForgotPasswordResponse{}, err
	}
	if err := passwordreset.ReplaceTokenForUser(ctx, pool, uid, h[:], exp); err != nil {
		return ForgotPasswordResponse{}, err
	}
	origin := strings.TrimRight(strings.TrimSpace(cfg.PublicWebOrigin), "/")
	resetURL := fmt.Sprintf("%s/reset-password?token=%s", origin, token)
	if err := mail.SendPasswordResetEmail(cfg, row.Email, resetURL); err != nil {
		log.Printf("mail: password reset send failed: %v", err)
	}
	return forgotMsg(), nil
}

// ResetPassword completes a reset with a one-time token.
func ResetPassword(ctx context.Context, pool *pgxpool.Pool, checker hibp.Checker, req ResetPasswordRequest) (ResetPasswordResponse, error) {
	tok := strings.TrimSpace(req.Token)
	if tok == "" {
		return ResetPasswordResponse{}, ErrInvalidResetToken
	}
	h := sha256.Sum256([]byte(tok))
	row, err := passwordreset.FindByTokenHash(ctx, pool, h[:])
	if err != nil {
		return ResetPasswordResponse{}, err
	}
	if row == nil {
		return ResetPasswordResponse{}, ErrInvalidResetToken
	}
	if row.UsedAt != nil {
		return ResetPasswordResponse{}, ErrInvalidResetToken
	}
	if time.Now().UTC().After(row.ExpiresAt) {
		return ResetPasswordResponse{}, ErrInvalidResetToken
	}
	hibpRes, err := enforceNewPassword(ctx, pool, nil, req.Password, checker)
	if err != nil {
		return ResetPasswordResponse{}, err
	}
	ph, err := pauth.HashPassword(req.Password)
	if err != nil {
		return ResetPasswordResponse{}, err
	}
	tid, err := uuid.Parse(row.ID)
	if err != nil {
		return ResetPasswordResponse{}, err
	}
	uid, err := uuid.Parse(row.UserID)
	if err != nil {
		return ResetPasswordResponse{}, err
	}
	ok, err := passwordreset.MarkUsedAndSetPassword(ctx, pool, tid, uid, ph)
	if err != nil {
		return ResetPasswordResponse{}, err
	}
	if !ok {
		return ResetPasswordResponse{}, ErrInvalidResetToken
	}
	_ = passwordcreditevents.Insert(ctx, pool, uid, passwordcreditevents.KindPasswordReset, hibpRes.BreachFound, hibpRes.HIBPAvailable)
	return ResetPasswordResponse{Message: "Your password has been updated. You can sign in now."}, nil
}

// ChangePassword updates the password for a signed-in user.
func ChangePassword(ctx context.Context, pool *pgxpool.Pool, checker hibp.Checker, userID uuid.UUID, req ChangePasswordRequest) (ChangePasswordResponse, error) {
	cur := strings.TrimSpace(req.CurrentPassword)
	newp := req.NewPassword
	if cur == "" || newp == "" {
		return ChangePasswordResponse{}, FieldError{Message: "Current password and new password are required."}
	}
	row, err := user.FindByID(ctx, pool, userID)
	if err != nil {
		return ChangePasswordResponse{}, err
	}
	if row == nil {
		return ChangePasswordResponse{}, FieldError{Message: "User not found."}
	}
	ok, err := pauth.VerifyPassword(cur, row.PasswordHash)
	if err != nil || !ok {
		return ChangePasswordResponse{}, FieldError{Message: "Current password is incorrect."}
	}
	hibpRes, err := enforceNewPassword(ctx, pool, nil, newp, checker)
	if err != nil {
		return ChangePasswordResponse{}, err
	}
	ph, err := pauth.HashPassword(newp)
	if err != nil {
		return ChangePasswordResponse{}, err
	}
	if err := user.SetPasswordHash(ctx, pool, userID, ph); err != nil {
		return ChangePasswordResponse{}, err
	}
	_ = passwordcreditevents.Insert(ctx, pool, userID, passwordcreditevents.KindPasswordChange, hibpRes.BreachFound, hibpRes.HIBPAvailable)
	return ChangePasswordResponse{Message: "Your password has been updated."}, nil
}

// ErrInvalidResetToken is returned when the reset link is wrong, used, or expired.
var ErrInvalidResetToken = errors.New("invalid reset token")

// HTTPErrorFor turns service errors into the legacy API status, code, and message. Unmapped errors get 500 INTERNAL.
func HTTPErrorFor(err error) (status int, code, msg string) {
	var fe FieldError
	if errors.As(err, &fe) {
		return http.StatusBadRequest, apierr.CodeInvalidInput, fe.Message
	}
	if errors.Is(err, ErrInvalidCredentials) {
		return http.StatusUnauthorized, apierr.CodeInvalidCredentials, "Invalid email or password."
	}
	if errors.Is(err, ErrEmailTaken) {
		return http.StatusConflict, apierr.CodeEmailTaken, "This email is already registered."
	}
	if errors.Is(err, ErrInvalidResetToken) {
		return http.StatusBadRequest, apierr.CodeInvalidResetToken, "This reset link is invalid or has expired. Request a new one from the sign-in page."
	}
	return http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong."
}

func forgotMsg() ForgotPasswordResponse {
	return ForgotPasswordResponse{
		Message: "If that email is registered, you will receive a reset link shortly.",
	}
}

// PlaceholderPasswordHash is an Argon2 hash of a random secret (OIDC/SAML JIT accounts without a password).
func PlaceholderPasswordHash() (string, error) {
	raw := make([]byte, 48)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	secret := base64.RawURLEncoding.EncodeToString(raw) + uuid.NewString()
	return pauth.HashPassword(secret)
}

// AuthResponseForUser builds a bearer response from a user row (OIDC/SAML completion).
func AuthResponseForUser(jwt *pauth.JWTSigner, row *user.Row) (AuthResponse, error) {
	return responseFromRow(jwt, row)
}

func responseFromRow(jwt *pauth.JWTSigner, row *user.Row) (AuthResponse, error) {
	tok, err := jwt.Sign(row.ID, row.Email)
	if err != nil {
		return AuthResponse{}, err
	}
	return AuthResponse{
		AccessToken: tok,
		TokenType:   "Bearer",
		User:        userPublicFromRow(row),
	}, nil
}

func userPublicFromRow(row *user.Row) UserPublic {
	return UserPublic{
		ID:          row.ID,
		Email:       row.Email,
		DisplayName: row.DisplayName,
		FirstName:   row.FirstName,
		LastName:    row.LastName,
		AvatarURL:   row.AvatarURL,
		UITheme:     row.UITheme,
		Sid:         row.Sid,
	}
}

func validateSignup(req *SignupRequest) error {
	email := user.NormalizeEmail(req.Email)
	if email == "" || !containsAt(email) || len(email) > 254 {
		return FieldError{Message: "Enter a valid email address."}
	}
	if req.Password == "" {
		return FieldError{Message: "Password is required."}
	}
	return nil
}

func validateLogin(req *LoginRequest) error {
	if strings.TrimSpace(req.Email) == "" || req.Password == "" {
		return FieldError{Message: "Email and password are required."}
	}
	return nil
}

func trimStringPtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

func containsAt(s string) bool {
	return strings.ContainsRune(s, '@')
}
