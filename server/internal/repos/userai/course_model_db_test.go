package userai

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestGetCourseSetupModelID_Default_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	dsn := os.Getenv("DATABASE_URL")
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()
	em := "ua-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("password1230")
	if err != nil {
		t.Fatal(err)
	}
	u, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatal(err)
	}
	uid, err := uuid.Parse(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := GetCourseSetupModelID(ctx, pool, uid)
	if err != nil {
		t.Fatal(err)
	}
	if got != DefaultCourseSetupModelID {
		t.Fatalf("default model: %q", got)
	}
}

func TestGetCourseSetupModelID_Explicit_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	dsn := os.Getenv("DATABASE_URL")
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()
	em := "ua2-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("password1230")
	if err != nil {
		t.Fatal(err)
	}
	u, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatal(err)
	}
	uid, err := uuid.Parse(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO "user".user_ai_settings (user_id, image_model_id, course_setup_model_id)
		VALUES ($1, 'google/gemini-2.5-flash-image', 'custom/model:free')
		ON CONFLICT (user_id) DO UPDATE SET course_setup_model_id = EXCLUDED.course_setup_model_id
	`, uid)
	if err != nil {
		t.Fatal(err)
	}
	got, err := GetCourseSetupModelID(ctx, pool, uid)
	if err != nil {
		t.Fatal(err)
	}
	if got != "custom/model:free" {
		t.Fatalf("model: %q", got)
	}
}

func TestGetCourseSetupModelID_NilPool(t *testing.T) {
	_, err := GetCourseSetupModelID(context.Background(), nil, uuid.New())
	if err == nil {
		t.Fatal("expected error")
	}
}
