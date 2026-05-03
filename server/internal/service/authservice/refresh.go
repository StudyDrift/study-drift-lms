package authservice

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	pauth "github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/geoip"
	"github.com/lextures/lextures/server/internal/repos/refreshtoken"
	"github.com/lextures/lextures/server/internal/repos/user"
)

const (
	refreshTokenRawBytes = 32
	refreshTokenTTL      = 30 * 24 * time.Hour
)

// ClientMeta captures optional HTTP client hints for refresh token rows.
type ClientMeta struct {
	UserAgent  string
	IP         net.IP
	AuthMethod string // e.g. password, oidc, saml, totp (stored on new refresh rows; plan 4.9)
}

// RefreshTokenResponse is returned by Refresh and Logout (rotation).
type RefreshTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// ErrRefreshInvalid is returned for bad, expired, or revoked refresh tokens.
var ErrRefreshInvalid = errors.New("invalid refresh token")

// ClientMetaFromRequest builds optional metadata from an HTTP request.
func ClientMetaFromRequest(r *http.Request) *ClientMeta {
	if r == nil {
		return nil
	}
	var ip net.IP
	if h := r.Header.Get("X-Forwarded-For"); h != "" {
		parts := strings.Split(h, ",")
		if len(parts) > 0 {
			ip = net.ParseIP(strings.TrimSpace(parts[0]))
		}
	}
	if ip == nil {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err == nil {
			ip = net.ParseIP(host)
		} else {
			ip = net.ParseIP(r.RemoteAddr)
		}
	}
	ua := strings.TrimSpace(r.Header.Get("User-Agent"))
	if ua == "" && ip == nil {
		return nil
	}
	return &ClientMeta{UserAgent: ua, IP: ip}
}

func authAndLocForNewToken(meta *ClientMeta, rotatedFrom *refreshtoken.Row) (ua string, auth *string, city *string, country *string) {
	if meta != nil && strings.TrimSpace(meta.UserAgent) != "" {
		ua = strings.TrimSpace(meta.UserAgent)
	} else if rotatedFrom != nil && rotatedFrom.UserAgent != nil && strings.TrimSpace(*rotatedFrom.UserAgent) != "" {
		ua = strings.TrimSpace(*rotatedFrom.UserAgent)
	}
	if rotatedFrom != nil {
		return ua, rotatedFrom.AuthMethod, rotatedFrom.LocationCity, rotatedFrom.LocationCountry
	}
	if meta != nil {
		if s := strings.TrimSpace(meta.AuthMethod); s != "" {
			auth = &s
		}
	}
	var c, co string
	if meta != nil {
		c, co = geoip.CityCountry(meta.IP)
	}
	if c != "" {
		city = &c
	}
	if co != "" {
		country = &co
	}
	return ua, auth, city, country
}

// MergeClientMeta returns a copy of meta with authMethod set when non-empty (for SSO/MFA callers).
func MergeClientMeta(meta *ClientMeta, authMethod string) *ClientMeta {
	out := ClientMeta{}
	if meta != nil {
		out = *meta
	}
	if s := strings.TrimSpace(authMethod); s != "" {
		out.AuthMethod = s
	}
	return &out
}

func issueAccessAndRefresh(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, row *user.Row, meta *ClientMeta) (access, refresh string, err error) {
	if pool == nil {
		tok, err := jwt.Sign(ctx, row.ID, row.Email, "", "", nil)
		return tok, "", err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	a, ref, err := issueAccessAndRefreshTx(ctx, pool, tx, jwt, row, meta, nil)
	if err != nil {
		return "", "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	return a, ref, nil
}

func issueAccessAndRefreshTx(ctx context.Context, pool *pgxpool.Pool, tx pgx.Tx, jwt *pauth.JWTSigner, row *user.Row, meta *ClientMeta, rotatedFrom *refreshtoken.Row) (access, refresh string, err error) {
	raw := make([]byte, refreshTokenRawBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	plain := base64.RawURLEncoding.EncodeToString(raw)
	h := sha256.Sum256([]byte(plain))
	exp := time.Now().UTC().Add(refreshTokenTTL)
	var ip net.IP
	if meta != nil {
		ip = meta.IP
	}
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		return "", "", err
	}
	ua, authPtr, cityPtr, countryPtr := authAndLocForNewToken(meta, rotatedFrom)
	now := time.Now().UTC()
	var refID uuid.UUID
	if rotatedFrom != nil {
		refID, err = refreshtoken.InsertTxWithLastRefreshed(ctx, tx, uid, h[:], exp, ua, ip, authPtr, cityPtr, countryPtr, now)
	} else {
		refID, err = refreshtoken.InsertTx(ctx, tx, uid, h[:], exp, ua, ip, authPtr, cityPtr, countryPtr)
	}
	if err != nil {
		return "", "", err
	}
	orgID, orgSlug, _, err := orgJWTFieldsForUser(ctx, pool, row.ID)
	if err != nil {
		return "", "", err
	}
	rtid := refID
	tok, err := jwt.Sign(ctx, row.ID, row.Email, orgID, orgSlug, &rtid)
	if err != nil {
		return "", "", err
	}
	return tok, plain, nil
}

// Refresh exchanges a refresh token for new access (+ rotated refresh).
func Refresh(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, rawRefresh string, meta *ClientMeta) (RefreshTokenResponse, error) {
	raw := strings.TrimSpace(rawRefresh)
	if raw == "" || pool == nil || jwt == nil {
		return RefreshTokenResponse{}, ErrRefreshInvalid
	}
	h := sha256.Sum256([]byte(raw))
	now := time.Now().UTC()

	tx, err := pool.Begin(ctx)
	if err != nil {
		return RefreshTokenResponse{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row, err := refreshtoken.FindActiveByHashForUpdate(ctx, tx, h[:], now)
	if err != nil {
		return RefreshTokenResponse{}, err
	}
	if row == nil {
		return RefreshTokenResponse{}, ErrRefreshInvalid
	}
	urow, err := user.FindByID(ctx, pool, row.UserID)
	if err != nil {
		return RefreshTokenResponse{}, err
	}
	if urow == nil || urow.LoginBlocked || urow.DeactivatedAt != nil {
		return RefreshTokenResponse{}, ErrRefreshInvalid
	}
	if st, err := orgStatusForUser(ctx, pool, urow.ID); err != nil {
		return RefreshTokenResponse{}, err
	} else if st == "suspended" {
		return RefreshTokenResponse{}, ErrOrgSuspended
	} else if st == "deleted" || st == "" {
		return RefreshTokenResponse{}, ErrRefreshInvalid
	}
	if err := refreshtoken.TouchLastRefreshed(ctx, tx, row.ID, now, now); err != nil {
		return RefreshTokenResponse{}, err
	}
	if err := refreshtoken.MarkRevoked(ctx, tx, row.ID, now); err != nil {
		return RefreshTokenResponse{}, err
	}
	access, newRefresh, err := issueAccessAndRefreshTx(ctx, pool, tx, jwt, urow, meta, row)
	if err != nil {
		return RefreshTokenResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RefreshTokenResponse{}, err
	}
	return RefreshTokenResponse{
		AccessToken:  access,
		RefreshToken: newRefresh,
		ExpiresIn:    int(pauth.AccessTokenTTL / time.Second),
		TokenType:    "Bearer",
	}, nil
}

// Logout revokes the refresh token identified by rawRefresh (rotation-safe: same tx pattern as Refresh without re-issue).
func Logout(ctx context.Context, pool *pgxpool.Pool, rawRefresh string) error {
	raw := strings.TrimSpace(rawRefresh)
	if raw == "" || pool == nil {
		return ErrRefreshInvalid
	}
	h := sha256.Sum256([]byte(raw))
	now := time.Now().UTC()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	row, err := refreshtoken.FindActiveByHashForUpdate(ctx, tx, h[:], now)
	if err != nil {
		return err
	}
	if row == nil {
		return ErrRefreshInvalid
	}
	if err := refreshtoken.MarkRevoked(ctx, tx, row.ID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// LogoutAll revokes every refresh token for the authenticated user.
func LogoutAll(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) error {
	if pool == nil {
		return nil
	}
	return refreshtoken.RevokeAllForUser(ctx, pool, userID, time.Now().UTC())
}

// RevokeAllSessionsForUser revokes refresh tokens and bumps JWT session version (admin / SCIM).
func RevokeAllSessionsForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) error {
	if pool == nil {
		return nil
	}
	now := time.Now().UTC()
	if err := refreshtoken.RevokeAllForUser(ctx, pool, userID, now); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `UPDATE "user".users SET jwt_session_version = jwt_session_version + 1 WHERE id = $1`, userID)
	return err
}

// InvalidatePasswordJWTs sets token_invalidated_at so existing access JWTs fail on next verify.
func InvalidatePasswordJWTs(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) error {
	if pool == nil {
		return nil
	}
	_, err := pool.Exec(ctx, `UPDATE "user".users SET token_invalidated_at = NOW() WHERE id = $1::uuid`, userID.String())
	return err
}
