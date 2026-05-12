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
	"github.com/lextures/lextures/server/internal/repos/orgbranding"
	"github.com/lextures/lextures/server/internal/repos/organization"
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
	// Client is optional HTTP metadata stored on refresh tokens (login handler).
	Client *ClientMeta
}

// SignupRequest mirrors models/auth SignupRequest.
type SignupRequest struct {
	Email       string
	Password    string
	DisplayName *string
	AccountType string // empty or "parent" (plan 5.10)
	Client      *ClientMeta
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
	AccountType string  `json:"accountType"`
}

// AuthResponse mirrors models/auth AuthResponse (field names are snake_case like the Rust `AuthResponse` struct).
type AuthResponse struct {
	AccessToken      string     `json:"access_token,omitempty"`
	RefreshToken     string     `json:"refresh_token,omitempty"`
	ExpiresIn        int        `json:"expires_in,omitempty"`
	MFAPendingToken  string     `json:"mfa_pending_token,omitempty"`
	TokenType        string     `json:"token_type"`
	User             UserPublic `json:"user"`
	RequiresMFA      bool       `json:"requires_mfa,omitempty"`
	MFASetupRequired bool       `json:"mfa_setup_required,omitempty"`
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

// ErrOrgSuspended is returned when the user's organization is suspended (plan 5.1 AC-5).
var ErrOrgSuspended = errors.New("org suspended")

// ErrEmailTaken is a unique email violation.
var ErrEmailTaken = errors.New("email taken")

// FieldError is client-facing input validation.
type FieldError struct{ Message string }

func (e FieldError) Error() string { return e.Message }

// Login .
func Login(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, cfg config.Config, req LoginRequest) (AuthResponse, error) {
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
	if row.DeactivatedAt != nil {
		return AuthResponse{}, ErrInvalidCredentials
	}
	if err := orgAuthGate(ctx, pool, row.ID); err != nil {
		return AuthResponse{}, err
	}
	ok, err := pauth.VerifyPassword(req.Password, row.PasswordHash)
	if err != nil || !ok {
		return AuthResponse{}, ErrInvalidCredentials
	}
	return issueAuthAfterCredentialSuccess(ctx, pool, jwt, cfg, row, MergeClientMeta(req.Client, "password"))
}

// Signup creates a password account. The first human user receives Global Admin only when
// cfg.BootstrapAdminEmail is set and matches the signup email (see docs/SECURITY_ISSUES.md C2).
func Signup(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, cfg config.Config, checker hibp.Checker, req SignupRequest) (AuthResponse, error) {
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

	tx, err := pool.Begin(ctx)
	if err != nil {
		return AuthResponse{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('signup_first_human'))`); err != nil {
		return AuthResponse{}, err
	}

	var humanCount int64
	err = tx.QueryRow(ctx, `
SELECT COUNT(*)::bigint FROM "user".users
WHERE id <> $1::uuid`, communication.PlatformInboxSenderID.String()).Scan(&humanCount)
	if err != nil {
		return AuthResponse{}, err
	}
	firstHuman := humanCount == 0

	row, err := user.InsertUserTx(ctx, tx, email, ph, dn)
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
	wantParent := strings.ToLower(strings.TrimSpace(req.AccountType)) == "parent"
	if wantParent {
		if _, err := tx.Exec(ctx, `UPDATE "user".users SET account_type = $2 WHERE id = $1`, uid, user.AccountTypeParent); err != nil {
			return AuthResponse{}, err
		}
		row.AccountType = user.AccountTypeParent
	}
	if firstHuman && cfg.BootstrapAdminEmail != "" && email == cfg.BootstrapAdminEmail {
		if err := rbac.AssignUserRoleByNameTx(ctx, tx, uid, "Global Admin"); err != nil {
			return AuthResponse{}, err
		}
	}
	if wantParent {
		if err := rbac.AssignUserRoleByNameTx(ctx, tx, uid, "Student"); err != nil {
			return AuthResponse{}, err
		}
	} else {
		if err := rbac.AssignUserRoleByNameTx(ctx, tx, uid, "Teacher"); err != nil {
			return AuthResponse{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return AuthResponse{}, err
	}

	_ = passwordcreditevents.Insert(ctx, pool, uid, passwordcreditevents.KindSignup, hibpRes.BreachFound, hibpRes.HIBPAvailable)
	communication.SendWelcomeMessage(ctx, pool, email)
	return responseFromRow(ctx, pool, jwt, row, MergeClientMeta(req.Client, "password"))
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

	var mailOpts *mail.PasswordResetOpts
	if orgID, oerr := organization.OrgIDForUser(ctx, pool, uid); oerr == nil {
		if br, berr := orgbranding.Get(ctx, pool, orgID); berr == nil && br != nil {
			mailOpts = &mail.PasswordResetOpts{
				PrimaryColor: br.PrimaryColor,
			}
			mailOpts.FromDisplayName = br.CustomEmailDisplayName
			mailOpts.LogoURL = br.LogoURL
		}
	}
	if err := mail.SendPasswordResetEmail(cfg, row.Email, resetURL, mailOpts); err != nil {
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
	if err := RevokeAllSessionsForUser(ctx, pool, uid); err != nil {
		return ResetPasswordResponse{}, err
	}
	if err := InvalidatePasswordJWTs(ctx, pool, uid); err != nil {
		return ResetPasswordResponse{}, err
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
	if err := RevokeAllSessionsForUser(ctx, pool, userID); err != nil {
		return ChangePasswordResponse{}, err
	}
	if err := InvalidatePasswordJWTs(ctx, pool, userID); err != nil {
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
	if errors.Is(err, ErrMagicLinkDisabled) {
		return http.StatusNotFound, apierr.CodeNotFound, "Magic link sign-in is not available."
	}
	if errors.Is(err, ErrMagicLinkRateLimited) {
		return http.StatusTooManyRequests, apierr.CodeRateLimited, "Too many sign-in link requests. Try again in a few minutes."
	}
	if errors.Is(err, ErrMagicLinkGone) {
		return http.StatusGone, apierr.CodeMagicLinkGone, "This link has already been used or has expired."
	}
	if errors.Is(err, ErrRefreshInvalid) {
		return http.StatusUnauthorized, apierr.CodeUnauthorized, "Session expired. Sign in again."
	}
	if errors.Is(err, ErrOrgSuspended) {
		return http.StatusForbidden, apierr.CodeOrgSuspended, "This organization has been suspended."
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

// AuthResponseForUser builds a bearer (or MFA-pending) response from a user row after SSO / MFA completion.
// authMethod is stored on the new refresh token (e.g. "oidc", "saml", "totp"); merged into meta.
func AuthResponseForUser(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, cfg config.Config, row *user.Row, meta *ClientMeta, authMethod string) (AuthResponse, error) {
	return issueAuthAfterCredentialSuccess(ctx, pool, jwt, cfg, row, MergeClientMeta(meta, authMethod))
}

func responseFromRow(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, row *user.Row, meta *ClientMeta) (AuthResponse, error) {
	access, refresh, err := issueAccessAndRefresh(ctx, pool, jwt, row, meta)
	if err != nil {
		return AuthResponse{}, err
	}
	res := AuthResponse{
		AccessToken: access,
		TokenType:   "Bearer",
		User:        userPublicFromRow(row),
	}
	if refresh != "" {
		res.RefreshToken = refresh
		res.ExpiresIn = int(pauth.AccessTokenTTL / time.Second)
	}
	return res, nil
}

func userPublicFromRow(row *user.Row) UserPublic {
	at := row.AccountType
	if at == "" {
		at = user.AccountTypeStandard
	}
	return UserPublic{
		ID:          row.ID,
		Email:       row.Email,
		DisplayName: row.DisplayName,
		FirstName:   row.FirstName,
		LastName:    row.LastName,
		AvatarURL:   row.AvatarURL,
		UITheme:     row.UITheme,
		Sid:         row.Sid,
		AccountType: at,
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
	acct := strings.ToLower(strings.TrimSpace(req.AccountType))
	if acct != "" && acct != "parent" {
		return FieldError{Message: "Unsupported account type."}
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
