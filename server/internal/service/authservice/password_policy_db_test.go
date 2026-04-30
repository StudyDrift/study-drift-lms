package authservice

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/auth/hibp"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/passwordcreditevents"
)

func TestSignup_RejectsBreachedPasswordWhenHIBPReportsHit_Pg(t *testing.T) {
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
	email := "pwpol-" + time.Now().Format("20060102150405.000000000") + "@example.com"
	checker := hibp.StubChecker{Result: hibp.Result{BreachFound: true, HIBPAvailable: true}}
	_, err = Signup(ctx, pool, jwt, checker, SignupRequest{Email: email, Password: "any-pass-here"})
	if err == nil {
		t.Fatal("expected error")
	}
	p, ok := IsPasswordPolicyViolation(err)
	if !ok {
		t.Fatalf("want PasswordPolicyViolation, got %v", err)
	}
	if p.Detail == "" {
		t.Fatal("empty detail")
	}
}

func TestChangePassword_AuditTrail_Pg(t *testing.T) {
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
	stub := hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	pass := "J7q#xM2pL9vRkW4$hN8zT1cY5bU6nM0aS"
	email := "pwc-" + time.Now().Format("20060102150405.000000000") + "@example.com"
	res, err := Signup(ctx, pool, jwt, stub, SignupRequest{Email: email, Password: pass})
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	uid, err := uuid.Parse(res.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	newPass := "K8r#yN3qM0wSx5$jO9zU2dV6cX7bH1fG4kL6pT8"
	_, err = ChangePassword(ctx, pool, stub, uid, ChangePasswordRequest{
		CurrentPassword: pass,
		NewPassword:     newPass,
	})
	if err != nil {
		t.Fatalf("change password: %v", err)
	}
	latest, err := passwordcreditevents.LatestForUser(ctx, pool, uid, passwordcreditevents.KindPasswordChange)
	if err != nil || latest == nil {
		t.Fatalf("latest event: %v %#v", err, latest)
	}
	if latest.BreachFound || !latest.HIBPAvailable {
		t.Fatalf("unexpected audit flags: %+v", latest)
	}
}
