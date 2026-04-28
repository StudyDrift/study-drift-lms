package enrollment

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server-new"
	"github.com/lextures/lextures/server-new/internal/auth"
	"github.com/lextures/lextures/server-new/internal/db"
	"github.com/lextures/lextures/server-new/internal/migrate"
	"github.com/lextures/lextures/server-new/internal/repos/user"
)

func TestListPeopleForEnrolledCourses_Empty_Pg(t *testing.T) {
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
	em := "peo-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("password1230")
	if err != nil {
		t.Fatal(err)
	}
	u, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(u.ID)
	got, err := ListPeopleForEnrolledCourses(ctx, pool, uid)
	if err != nil {
		t.Fatalf("people: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected no people: %d", len(got))
	}
}
