package authservice

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/auth/hibp"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
)

func TestMagicLink_RequestRateLimit_Pg(t *testing.T) {
	if testing.Short() {
		t.Skip("database")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()
	jwt := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	stub := hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	pass := "J7q#xM2pL9vRkW4$hN8zT1cY5bU6nM0aS"
	email := "magic-rl-" + time.Now().Format("20060102150405.000000000") + "@example.com"
	if _, err := Signup(ctx, pool, jwt, stub, SignupRequest{Email: email, Password: pass}); err != nil {
		t.Fatalf("signup: %v", err)
	}
	cfg := config.Config{
		PublicWebOrigin:  "http://localhost:5173",
		MFAEnabled:       false,
		MagicLinkEnabled: true,
	}
	for i := 0; i < 3; i++ {
		res, err := RequestMagicLink(ctx, pool, cfg, MagicLinkRequestRequest{Email: email})
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		if res.Message == "" {
			t.Fatalf("empty message %d", i)
		}
	}
	if _, err := RequestMagicLink(ctx, pool, cfg, MagicLinkRequestRequest{Email: email}); err == nil {
		t.Fatal("expected rate limit error")
	} else if !errors.Is(err, ErrMagicLinkRateLimited) {
		t.Fatalf("want rate limited, got %v", err)
	}
}

func TestMagicLink_Consume_Pg(t *testing.T) {
	if testing.Short() {
		t.Skip("database")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()
	jwt := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	stub := hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	pass := "J7q#xM2pL9vRkW4$hN8zT1cY5bU6nM0aS"
	email := "magic-consume-" + time.Now().Format("20060102150405.000000000") + "@example.com"
	su, err := Signup(ctx, pool, jwt, stub, SignupRequest{Email: email, Password: pass})
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	uid, err := uuid.Parse(su.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	const plaintext = "unit-test-magic-token-32bytes!!"
	h := sha256.Sum256([]byte(plaintext))
	_, err = pool.Exec(ctx, `
INSERT INTO "user".magic_link_tokens (user_id, token_hash, expires_at, redirect_to)
VALUES ($1::uuid, $2, NOW() + INTERVAL '30 minutes', $3)
`, uid.String(), h[:], "/courses/foo")
	if err != nil {
		t.Fatalf("insert token: %v", err)
	}
	cfg := config.Config{PublicWebOrigin: "http://localhost:5173", MFAEnabled: false, MagicLinkEnabled: true}
	res, err := ConsumeMagicLink(ctx, pool, jwt, cfg, plaintext)
	if err != nil {
		t.Fatalf("consume: %v", err)
	}
	if res.AccessToken == "" {
		t.Fatal("expected access token")
	}
	if _, err := ConsumeMagicLink(ctx, pool, jwt, cfg, plaintext); err == nil {
		t.Fatal("expected gone on replay")
	} else if !errors.Is(err, ErrMagicLinkGone) {
		t.Fatalf("want gone, got %v", err)
	}
}
