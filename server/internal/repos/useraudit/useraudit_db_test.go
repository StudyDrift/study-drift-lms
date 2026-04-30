package useraudit

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

func TestInsertAndStructureItem_Pg(t *testing.T) {
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
	em := "uau-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("password1230")
	if err != nil {
		t.Fatal(err)
	}
	u, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(u.ID)
	// course_code must match ^C-[A-Z0-9]{6}$ (8 chars total).
	cc := fmt.Sprintf("C-AB%04d", time.Now().UnixNano()%10000)
	var courseID uuid.UUID
	err = pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id)
VALUES ($1, 'Test course', $2) RETURNING id
`, cc, uid).Scan(&courseID)
	if err != nil {
		t.Fatalf("course: %v", err)
	}
	_, err = pool.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'student')
`, courseID, uid)
	if err != nil {
		t.Fatalf("enrollment: %v", err)
	}
	var modID uuid.UUID
	err = pool.QueryRow(ctx, `
INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id)
VALUES ($1, 0, 'module', 'Mod', NULL) RETURNING id
`, courseID).Scan(&modID)
	if err != nil {
		t.Fatalf("module: %v", err)
	}
	var pageID uuid.UUID
	err = pool.QueryRow(ctx, `
INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id)
VALUES ($1, 0, 'content_page', 'Page', $2) RETURNING id
`, courseID, modID).Scan(&pageID)
	if err != nil {
		t.Fatalf("page: %v", err)
	}
	ok, err := StructureItemIsCourseContentPage(ctx, pool, courseID, pageID)
	if err != nil || !ok {
		t.Fatalf("StructureItemIsCourseContentPage: %v %v", ok, err)
	}
	bad := uuid.New()
	ok, err = StructureItemIsCourseContentPage(ctx, pool, courseID, bad)
	if err != nil || ok {
		t.Fatalf("expected false for random id: %v %v", ok, err)
	}
	if err := Insert(ctx, pool, uid, courseID, nil, "course_visit"); err != nil {
		t.Fatalf("insert visit: %v", err)
	}
	if err := Insert(ctx, pool, uid, courseID, &pageID, "content_open"); err != nil {
		t.Fatalf("insert open: %v", err)
	}
}
