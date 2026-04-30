package coursestructure

import (
	"context"
	"fmt"
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

// TestListForCourseWithEnrichment_Pg checks structure rows are returned and ordered.
func TestListForCourseWithEnrichment_Pg(t *testing.T) {
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
	em := "cstruct-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	var courseID uuid.UUID
	// course_code must match ^C-[A-Z0-9]{6}$ (migration 005).
	cc := fmt.Sprintf("C-S%05d", time.Now().UnixNano()%100000)
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'Struct', $2) RETURNING id
`, cc, uid).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}
	var modID, pageID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.course_structure_items
    (course_id, sort_order, kind, title, parent_id, published, archived, visible_from)
    VALUES ($1, 0, 'module', 'M1', NULL, true, false, NULL) RETURNING id
`, courseID).Scan(&modID); err != nil {
		t.Fatalf("module: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO course.course_structure_items
    (course_id, sort_order, kind, title, parent_id, published, archived)
    VALUES ($1, 0, 'content_page', 'P1', $2, true, false) RETURNING id
`, courseID, modID).Scan(&pageID); err != nil {
		t.Fatalf("page: %v", err)
	}
	items, err := ListForCourseWithEnrichment(ctx, pool, courseID, true)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) < 2 {
		t.Fatalf("expected at least 2 items, got %d", len(items))
	}
	if items[0].Kind != "module" || items[1].Kind != "content_page" {
		t.Fatalf("order: first two kinds %q %q", items[0].Kind, items[1].Kind)
	}
	if items[1].ID != pageID.String() {
		t.Fatalf("expected second item to be the content page %s, got %s", pageID, items[1].ID)
	}
	// student view: unpublished module is hidden
	if _, err := pool.Exec(ctx, `UPDATE course.course_structure_items SET published = false WHERE id = $1`, modID); err != nil {
		t.Fatalf("update: %v", err)
	}
	rows, err := ListForCourse(ctx, pool, courseID)
	if err != nil {
		t.Fatalf("list2: %v", err)
	}
	rows = FilterArchivedItems(rows)
	rows = FilterStructureForStudentView(rows, time.Now().UTC())
	if len(rows) != 0 {
		t.Fatalf("expected student view empty when module unpublished, got %d", len(rows))
	}
}
