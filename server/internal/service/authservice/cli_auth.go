package authservice

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	pauth "github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/repos/cliauthsession"
	"github.com/lextures/lextures/server/internal/repos/user"
)

const cliAuthSessionTTL = 10 * time.Minute

// ErrCLISessionNotFound is returned when the token is unknown or expired.
var ErrCLISessionNotFound = errors.New("CLI auth session not found or expired")

// ErrCLISessionAlreadyApproved is returned on a double-approve attempt.
var ErrCLISessionAlreadyApproved = errors.New("CLI auth session already approved")

// CLIPollResult is returned by PollCLIAuth.
type CLIPollResult struct {
	Approved     bool
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
}

// RequestCLIAuth creates a pending CLI auth session and returns the plain token.
func RequestCLIAuth(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	plain := base64.RawURLEncoding.EncodeToString(raw)
	h := sha256.Sum256([]byte(plain))
	exp := time.Now().UTC().Add(cliAuthSessionTTL)
	if err := cliauthsession.Insert(ctx, pool, h[:], exp); err != nil {
		return "", err
	}
	return plain, nil
}

// ApproveCLIAuth issues tokens for userID and stores them against the pending session.
func ApproveCLIAuth(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, token string, userID uuid.UUID, meta *ClientMeta) error {
	h := sha256.Sum256([]byte(token))
	row, err := cliauthsession.FindActiveByTokenHash(ctx, pool, h[:], time.Now().UTC())
	if err != nil {
		return err
	}
	if row == nil {
		return ErrCLISessionNotFound
	}
	if row.ApprovedAt != nil {
		return ErrCLISessionAlreadyApproved
	}

	urow, err := user.FindByID(ctx, pool, userID)
	if err != nil {
		return err
	}
	if urow == nil {
		return errors.New("user not found")
	}

	access, refresh, err := issueAccessAndRefresh(ctx, pool, jwt, urow, meta)
	if err != nil {
		return err
	}

	expiresIn := int(pauth.AccessTokenTTL / time.Second)
	return cliauthsession.Approve(ctx, pool, h[:], access, refresh, expiresIn)
}

// PollCLIAuth checks whether a CLI session has been approved and returns the tokens.
func PollCLIAuth(ctx context.Context, pool *pgxpool.Pool, token string) (*CLIPollResult, error) {
	h := sha256.Sum256([]byte(token))
	row, err := cliauthsession.FindActiveByTokenHash(ctx, pool, h[:], time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, ErrCLISessionNotFound
	}
	if row.ApprovedAt == nil {
		return &CLIPollResult{Approved: false}, nil
	}
	result := &CLIPollResult{
		Approved: true,
	}
	if row.AccessToken != nil {
		result.AccessToken = *row.AccessToken
	}
	if row.RefreshToken != nil {
		result.RefreshToken = *row.RefreshToken
	}
	if row.ExpiresIn != nil {
		result.ExpiresIn = *row.ExpiresIn
	}
	return result, nil
}
