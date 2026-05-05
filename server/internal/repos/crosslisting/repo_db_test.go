package crosslisting_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/crosslisting"
)

func TestExpandInstructorSectionFilter_MergedGroup_Pg(t *testing.T) {
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

	cc := fmt.Sprintf("C-E%05d", time.Now().UnixNano()%100000)
	var courseID uuid.UUID
	var orgID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM tenant.organizations WHERE slug = 'default'`).Scan(&orgID); err != nil {
		t.Fatalf("org: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, org_id)
VALUES ($1, 'cross-list test', $2)
RETURNING id
`, cc, orgID).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}

	var secA, secB uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.course_sections (course_id, section_code, status) VALUES ($1, '001', 'active') RETURNING id
`, courseID).Scan(&secA); err != nil {
		t.Fatalf("section a: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO course.course_sections (course_id, section_code, status) VALUES ($1, '002', 'active') RETURNING id
`, courseID).Scan(&secB); err != nil {
		t.Fatalf("section b: %v", err)
	}

	g, err := crosslisting.CreateGroup(ctx, pool, orgID, courseID, secA, nil)
	if err != nil || g == nil {
		t.Fatalf("create group: %v", g)
	}
	g, err = crosslisting.AddMember(ctx, pool, orgID, courseID, secB)
	if err != nil || g == nil {
		t.Fatalf("add member: %v", g)
	}

	filter := []uuid.UUID{secA}
	out, err := crosslisting.ExpandInstructorSectionFilter(ctx, pool, courseID, filter, true)
	if err != nil {
		t.Fatalf("expand: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 section ids in merged filter, got %d", len(out))
	}
	single, err := crosslisting.ExpandInstructorSectionFilter(ctx, pool, courseID, filter, false)
	if err != nil {
		t.Fatalf("expand single: %v", err)
	}
	if len(single) != 1 || single[0] != secA {
		t.Fatalf("merged off should keep single section")
	}
}
