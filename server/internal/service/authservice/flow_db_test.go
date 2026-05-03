package authservice

import (
	"context"
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
	"github.com/lextures/lextures/server/internal/repos/rbac"
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
	jwt := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	stub := hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	pass := "J7q#xM2pL9vRkW4$hN8zT1cY5bU6nM0aS"
	email := "e2e-" + time.Now().Format("20060102150405.000000000") + "@example.com"
	_, err = Signup(ctx, pool, jwt, stub, SignupRequest{Email: email, Password: pass, DisplayName: displayName("T")})
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	_, err = Signup(ctx, pool, jwt, stub, SignupRequest{Email: email, Password: pass})
	if !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("second signup: %v", err)
	}
	if _, err := Login(ctx, pool, jwt, LoginRequest{Email: email, Password: "wrong"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("login bad pass: %v", err)
	}
	res, err := Login(ctx, pool, jwt, LoginRequest{Email: email, Password: pass})
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
	if _, err := ResetPassword(ctx, pool, stub, ResetPasswordRequest{Token: "nope", Password: pass}); !errors.Is(err, ErrInvalidResetToken) {
		t.Fatalf("reset bad token: %v", err)
	}
}

// TestSignup_FirstHumanGetsGlobalAdmin_Pg asserts the first password signup after migrations gets Global Admin.
// This DB may already have human users from prior tests; skip when not empty.
func TestSignup_FirstHumanGetsGlobalAdmin_Pg(t *testing.T) {
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

	var otherHumans int64
	err = pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint FROM "user".users u
WHERE u.id <> 'a0000000-0000-4000-8000-000000000001'::uuid`).Scan(&otherHumans)
	if err != nil {
		t.Fatalf("count humans: %v", err)
	}
	if otherHumans > 0 {
		t.Skip("database already has human users")
	}

	jwt := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	stub := hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	pass := "J7q#xM2pL9vRkW4$hN8zT1cY5bU6nM0aS"
	email := "ga-first-" + time.Now().Format("20060102150405.000000000") + "@example.com"
	res, err := Signup(ctx, pool, jwt, stub, SignupRequest{Email: email, Password: pass, DisplayName: displayName("Admin")})
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	uid, err := uuid.Parse(res.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := rbac.UserHasPermission(ctx, pool, uid, "global:app:rbac:manage")
	if err != nil {
		t.Fatalf("rbac: %v", err)
	}
	if !ok {
		t.Fatal("expected first signup to have global:app:rbac:manage (Global Admin)")
	}
}

func displayName(s string) *string { return &s }
