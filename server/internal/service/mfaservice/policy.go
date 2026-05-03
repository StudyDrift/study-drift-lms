package mfaservice

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/config"
)

// EffectiveMFA returns merged MFA feature flag and enforcement from config (env + optional DB merge caller).
func EffectiveMFA(cfg config.Config) (enabled bool, enforcement string) {
	enf := strings.ToLower(strings.TrimSpace(cfg.MFAEnforcement))
	switch enf {
	case "all", "staff":
	default:
		enf = "none"
	}
	return cfg.MFAEnabled, enf
}

// UserHasVerifiedMFA is true when the user has at least one active TOTP (verified) or WebAuthn credential.
func UserHasVerifiedMFA(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1 FROM "user".mfa_totp_credentials WHERE user_id = $1 AND verified
	UNION ALL
	SELECT 1 FROM "user".mfa_webauthn_credentials WHERE user_id = $1
)`, userID).Scan(&ok)
	return ok, err
}

// UserMatchesStaffEnforcement is true when the user holds a global Teacher, TA, or Global Admin role.
func UserMatchesStaffEnforcement(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM "user".user_app_roles uar
	INNER JOIN "user".app_roles ar ON ar.id = uar.role_id
	WHERE uar.user_id = $1
	  AND ar.name IN ('Teacher', 'TA', 'Global Admin')
)`, userID).Scan(&ok)
	return ok, err
}

// EnrolmentRequiredBeforeAccess returns true when policy requires the user to complete MFA enrolment before a full session.
func EnrolmentRequiredBeforeAccess(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, userID uuid.UUID) (bool, error) {
	on, enf := EffectiveMFA(cfg)
	if !on || enf == "none" {
		return false, nil
	}
	has, err := UserHasVerifiedMFA(ctx, pool, userID)
	if err != nil || has {
		return false, err
	}
	switch enf {
	case "all":
		return true, nil
	case "staff":
		return UserMatchesStaffEnforcement(ctx, pool, userID)
	default:
		return false, nil
	}
}
