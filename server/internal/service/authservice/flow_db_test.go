package authservice

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
)

// Exercise signup/login/email-taken and password reset against a real Postgres (CI or local).
func TestAuthFlow_Pg(t *testing.T) {
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
	jwt := auth.NewJWTSigner("01234567890123456789012345678901")
	email := "e2e-" + time.Now().Format("20060102150405.000000000") + "@example.com"
	_, err = Signup(ctx, pool, jwt, SignupRequest{Email: email, Password: "12345678", DisplayName: displayName("T")})
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	_, err = Signup(ctx, pool, jwt, SignupRequest{Email: email, Password: "12345678"})
	if !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("second signup: %v", err)
	}
	if _, err := Login(ctx, pool, jwt, LoginRequest{Email: email, Password: "wrong"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("login bad pass: %v", err)
	}
	res, err := Login(ctx, pool, jwt, LoginRequest{Email: email, Password: "12345678"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if res.AccessToken == "" {
		t.Fatal("empty token")
	}
	cfg := config.Config{PublicWebOrigin: "http://localhost:5173"}
	if _, err := RequestPasswordReset(ctx, pool, cfg, email); err != nil {
		t.Fatalf("forgot: %v", err)
	}
	// full reset would need the raw token; wrong token path is covered
	if _, err := ResetPassword(ctx, pool, ResetPasswordRequest{Token: "nope", Password: "12345678"}); !errors.Is(err, ErrInvalidResetToken) {
		t.Fatalf("reset bad token: %v", err)
	}
}

func displayName(s string) *string { return &s }
