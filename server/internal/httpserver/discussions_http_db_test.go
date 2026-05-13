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
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestDiscussionForums_EnabledFlow_Pg(t *testing.T) {
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

	em := "disc-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	cc := fmt.Sprintf("C-D%05d", time.Now().UnixNano()%100000)
	var courseID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'T', $2) RETURNING id
`, cc, uid).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE course.courses SET discussions_enabled = true WHERE id = $1`, courseID); err != nil {
		t.Fatalf("enable discussions: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'teacher')`, courseID, uid); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, err := signer.Sign(ctx, row.ID, em, "", "", nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	d := Deps{Pool: pool, JWTSigner: signer, Config: config.Config{}}
	h := NewHandler(d)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/forums", nil)
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list forums: %d %s", rr.Code, rr.Body.String())
	}

	body := map[string]any{"name": "General"}
	b, _ := json.Marshal(body)
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+cc+"/forums", bytes.NewReader(b))
	req2 = req2.WithContext(ctx)
	req2.Header.Set("Authorization", "Bearer "+tok)
	req2.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("create forum: %d %s", rr2.Code, rr2.Body.String())
	}
}

func TestDiscussionForums_DisabledReturns404_Pg(t *testing.T) {
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

	em := "disc2-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	cc := fmt.Sprintf("C-E%05d", time.Now().UnixNano()%100000)
	var courseID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'T', $2) RETURNING id
`, cc, uid).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'student')`, courseID, uid); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, err := signer.Sign(ctx, row.ID, em, "", "", nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	d := Deps{Pool: pool, JWTSigner: signer, Config: config.Config{}}
	h := NewHandler(d)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/forums", nil)
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when disabled, got %d %s", rr.Code, rr.Body.String())
	}
}
