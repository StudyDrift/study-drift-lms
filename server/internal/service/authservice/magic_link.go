package authservice

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	pauth "github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/mail"
	"github.com/lextures/lextures/server/internal/repos/magiclinktoken"
	"github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/mfaservice"
)

const (
	magicLinkTokenTTL     = 15 * time.Minute
	magicLinkRateWindow   = 5 * time.Minute
	magicLinkRateMax      = 3
	magicLinkTokenBytes   = 32 // 256-bit raw → URL-safe base64
)

// ErrMagicLinkDisabled is returned when MAGIC_LINK_ENABLED is false.
var ErrMagicLinkDisabled = errors.New("magic link disabled")

// ErrMagicLinkRateLimited is returned when too many requests were made for one user.
var ErrMagicLinkRateLimited = errors.New("magic link rate limited")

// ErrMagicLinkGone is returned when the token is invalid, used, or expired (HTTP 410).
var ErrMagicLinkGone = errors.New("magic link gone")

// MagicLinkRequestRequest is POST /auth/magic-link/request body.
type MagicLinkRequestRequest struct {
	Email       string
	RedirectTo  *string
}

// MagicLinkRequestResponse is always 200 with this body when input is valid.
type MagicLinkRequestResponse struct {
	Message string `json:"message"`
}

// RequestMagicLink sends a one-time login email when the user exists and feature is enabled.
func RequestMagicLink(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, req MagicLinkRequestRequest) (MagicLinkRequestResponse, error) {
	if !cfg.MagicLinkEnabled {
		return MagicLinkRequestResponse{}, ErrMagicLinkDisabled
	}
	e := user.NormalizeEmail(req.Email)
	if e == "" || !containsAt(e) || len(e) > 254 {
		return MagicLinkRequestResponse{}, FieldError{Message: "Enter a valid email address."}
	}
	var redirectPtr *string
	if req.RedirectTo != nil {
		rt := strings.TrimSpace(*req.RedirectTo)
		if rt != "" {
			if _, err := magicLinkSanitizeRedirect(cfg.PublicWebOrigin, rt); err != nil {
				return MagicLinkRequestResponse{}, FieldError{Message: err.Error()}
			}
			redirectPtr = &rt
		}
	}
	row, err := user.FindByEmail(ctx, pool, e)
	if err != nil {
		return MagicLinkRequestResponse{}, err
	}
	if row == nil {
		return magicLinkPublicOK(), nil
	}
	if row.LoginBlocked || row.DeactivatedAt != nil {
		return magicLinkPublicOK(), nil
	}
	if cfg.MagicLinkEnrolledOnly {
		var n int64
		err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint FROM course.course_enrollments ce
WHERE ce.user_id = $1::uuid AND COALESCE(ce.active, true) = true
`, row.ID).Scan(&n)
		if err != nil {
			return MagicLinkRequestResponse{}, err
		}
		if n == 0 {
			return magicLinkPublicOK(), nil
		}
	}
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		return MagicLinkRequestResponse{}, err
	}
	nReq, err := magiclinktoken.CountRecentRequestsForUser(ctx, pool, uid, magicLinkRateWindow)
	if err != nil {
		return MagicLinkRequestResponse{}, err
	}
	if nReq >= magicLinkRateMax {
		magicLinkMetrics.rateLimited.Add(1)
		return MagicLinkRequestResponse{}, ErrMagicLinkRateLimited
	}
	raw := make([]byte, magicLinkTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return MagicLinkRequestResponse{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	h := sha256.Sum256([]byte(token))
	exp := time.Now().UTC().Add(magicLinkTokenTTL)
	if err := magiclinktoken.Insert(ctx, pool, uid, h[:], exp, redirectPtr); err != nil {
		return MagicLinkRequestResponse{}, err
	}
	origin := strings.TrimRight(strings.TrimSpace(cfg.PublicWebOrigin), "/")
	magicURL := fmt.Sprintf("%s/login/magic-link?token=%s", origin, url.QueryEscape(token))
	if redirectPtr != nil {
		magicURL += "&redirect_to=" + url.QueryEscape(*redirectPtr)
	}
	magicLinkMetrics.requested.Add(1)
	if err := mail.SendMagicLinkEmail(cfg, row.Email, magicURL); err != nil {
		log.Printf("mail: magic link send failed: %v", err)
	}
	return magicLinkPublicOK(), nil
}

func magicLinkPublicOK() MagicLinkRequestResponse {
	return MagicLinkRequestResponse{
		Message: "If an account exists with that email, you will receive a sign-in link shortly.",
	}
}

// ConsumeMagicLink validates the token, marks it consumed, and returns the same auth shape as login.
func ConsumeMagicLink(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, cfg config.Config, rawToken string, meta *ClientMeta) (AuthResponse, error) {
	if !cfg.MagicLinkEnabled {
		return AuthResponse{}, ErrMagicLinkDisabled
	}
	tok := strings.TrimSpace(rawToken)
	if tok == "" {
		return AuthResponse{}, ErrMagicLinkGone
	}
	h := sha256.Sum256([]byte(tok))
	now := time.Now().UTC()
	row, err := magiclinktoken.FindActiveByTokenHash(ctx, pool, h[:], now)
	if err != nil {
		return AuthResponse{}, err
	}
	if row == nil {
		anyRow, err := magiclinktoken.FindByTokenHash(ctx, pool, h[:])
		if err != nil {
			return AuthResponse{}, err
		}
		if anyRow != nil {
			magicLinkMetrics.expired.Add(1)
		}
		return AuthResponse{}, ErrMagicLinkGone
	}
	tid, err := uuid.Parse(row.ID)
	if err != nil {
		return AuthResponse{}, err
	}
	ok, err := magiclinktoken.MarkConsumed(ctx, pool, tid)
	if err != nil {
		return AuthResponse{}, err
	}
	if !ok {
		return AuthResponse{}, ErrMagicLinkGone
	}
	uidUser, err := uuid.Parse(row.UserID)
	if err != nil {
		return AuthResponse{}, err
	}
	urow, err := user.FindByID(ctx, pool, uidUser)
	if err != nil {
		return AuthResponse{}, err
	}
	if urow == nil {
		return AuthResponse{}, ErrMagicLinkGone
	}
	if urow.LoginBlocked || urow.DeactivatedAt != nil {
		return AuthResponse{}, ErrMagicLinkGone
	}
	magicLinkMetrics.consumed.Add(1)
	return issueAuthAfterCredentialSuccess(ctx, pool, jwt, cfg, urow, MergeClientMeta(meta, "magic_link"))
}

// issueAuthAfterCredentialSuccess issues MFA pending or access token after password/magic-link verification.
func issueAuthAfterCredentialSuccess(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, cfg config.Config, row *user.Row, meta *ClientMeta) (AuthResponse, error) {
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		return AuthResponse{}, err
	}
	if pool != nil {
		if err := orgAuthGate(ctx, pool, row.ID); err != nil {
			return AuthResponse{}, err
		}
	}
	needEnrol, err := mfaservice.EnrolmentRequiredBeforeAccess(ctx, pool, cfg, uid)
	if err != nil {
		return AuthResponse{}, err
	}
	if needEnrol {
		jti := uuid.NewString()
		pend, err := jwt.SignMFAPending(ctx, row.ID, row.Email, jti, "setup")
		if err != nil {
			return AuthResponse{}, err
		}
		return AuthResponse{
			MFAPendingToken:  pend,
			TokenType:        "Bearer",
			User:             userPublicFromRow(row),
			MFASetupRequired: true,
		}, nil
	}
	hasMFA, err := mfaservice.UserHasVerifiedMFA(ctx, pool, uid)
	if err != nil {
		return AuthResponse{}, err
	}
	if hasMFA {
		jti := uuid.NewString()
		pend, err := jwt.SignMFAPending(ctx, row.ID, row.Email, jti, "challenge")
		if err != nil {
			return AuthResponse{}, err
		}
		return AuthResponse{
			MFAPendingToken: pend,
			TokenType:       "Bearer",
			User:            userPublicFromRow(row),
			RequiresMFA:     true,
		}, nil
	}
	return responseFromRow(ctx, pool, jwt, row, meta)
}

func magicLinkSanitizeRedirect(publicOrigin, redirectTo string) (string, error) {
	rt := strings.TrimSpace(redirectTo)
	if rt == "" {
		return "", nil
	}
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(publicOrigin), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", errors.New("redirect_to is not allowed.")
	}
	u, err := url.Parse(rt)
	if err != nil {
		return "", errors.New("redirect_to is not allowed.")
	}
	if u.IsAbs() {
		if u.Scheme != base.Scheme || !strings.EqualFold(u.Host, base.Host) {
			return "", errors.New("redirect_to is not allowed.")
		}
		path := u.EscapedPath()
		if path == "" {
			path = "/"
		}
		q := u.RawQuery
		if q != "" {
			return path + "?" + q, nil
		}
		return path, nil
	}
	if !strings.HasPrefix(rt, "/") || strings.HasPrefix(rt, "//") {
		return "", errors.New("redirect_to is not allowed.")
	}
	return rt, nil
}
