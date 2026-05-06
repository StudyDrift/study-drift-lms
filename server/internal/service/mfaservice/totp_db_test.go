package mfaservice

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	serverdata "github.com/lextures/lextures/server"
	"github.com/pquerna/otp/totp"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/migrate"
)

func TestTOTPChallengeReplaySamePeriod(t *testing.T) {
	if testing.Short() {
		t.Skip("database")
	}
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		t.Skip("DATABASE_URL")
	}
	ctx := context.Background()
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	uid := testMFAUser(t, ctx, pool)
	cfg := config.Config{MFAEnabled: true}

	key, err := totp.Generate(totp.GenerateOpts{Issuer: "T", AccountName: "u@test.com"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
INSERT INTO "user".mfa_totp_credentials (user_id, secret, verified)
VALUES ($1, $2, true)
`, uid, key.Secret())
	if err != nil {
		t.Fatal(err)
	}
	code, err := totp.GenerateCode(key.Secret(), time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if err := TOTPChallenge(ctx, pool, cfg, uid, code); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := TOTPChallenge(ctx, pool, cfg, uid, code); err == nil {
		t.Fatal("expected replay error")
	}
}

func testMFAUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ph, err := auth.HashPassword("unused-password-for-mfa-test-9xK#mP2qL")
	if err != nil {
		t.Fatal(err)
	}
	var id uuid.UUID
	err = pool.QueryRow(ctx, `
INSERT INTO "user".users (email, password_hash, display_name)
VALUES ($1, $2, 'mfa test')
RETURNING id
`, "mfa-test-"+uuid.NewString()+"@example.com", ph).Scan(&id)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "user".users WHERE id = $1`, id)
	})
	return id
}
