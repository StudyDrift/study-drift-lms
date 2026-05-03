package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/models/useraudit"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestPostCourseContext_Pg(t *testing.T) {
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
	em := "cctx-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	cc := fmt.Sprintf("C-AB%04d", time.Now().UnixNano()%10000)
	var courseID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'T', $2) RETURNING id
`, cc, uid).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'student')`, courseID, uid); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	var modID uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id) VALUES ($1, 0, 'module', 'M', NULL) RETURNING id`, courseID).Scan(&modID); err != nil {
		t.Fatalf("mod: %v", err)
	}
	var pageID uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id) VALUES ($1, 0, 'content_page', 'P', $2) RETURNING id`, courseID, modID).Scan(&pageID); err != nil {
		t.Fatalf("page: %v", err)
	}
	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, err := signer.Sign(ctx, row.ID, em)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	d := Deps{Pool: pool, JWTSigner: signer}
	h := NewHandler(d)

	visitBody, _ := json.Marshal(useraudit.PostCourseContextRequest{Kind: "course_visit"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+cc+"/course-context", bytes.NewReader(visitBody))
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("visit: %d %s", rr.Code, rr.Body.String())
	}

	sid := pageID.String()
	openBody, _ := json.Marshal(useraudit.PostCourseContextRequest{Kind: "content_open", StructureItemID: &sid})
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+cc+"/course-context", bytes.NewReader(openBody))
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("open: %d %s", rr.Code, rr.Body.String())
	}
}
