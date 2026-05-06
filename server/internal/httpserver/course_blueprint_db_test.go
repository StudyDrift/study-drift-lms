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
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestCourseBlueprint_LinkCloneAndPush_Pg(t *testing.T) {
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
	em := "blp-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, uid, "Global Admin"); err != nil {
		t.Fatalf("ga: %v", err)
	}
	suffix := time.Now().UnixNano() % 100000
	bpCode := fmt.Sprintf("C-B%05d", suffix)
	chCode := fmt.Sprintf("C-C%05d", suffix)
	var bpID, chID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'Blueprint master', $2) RETURNING id
`, bpCode, uid).Scan(&bpID); err != nil {
		t.Fatalf("bp course: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'Child shell', $2) RETURNING id
`, chCode, uid).Scan(&chID); err != nil {
		t.Fatalf("ch course: %v", err)
	}
	for _, x := range []struct {
		cid uuid.UUID
	}{
		{bpID},
		{chID},
	} {
		if _, err := pool.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'instructor')
`, x.cid, uid); err != nil {
			t.Fatalf("enroll: %v", err)
		}
	}
	var modID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id, published) VALUES ($1, 0, 'module', 'Mod', NULL, true) RETURNING id
`, bpID).Scan(&modID); err != nil {
		t.Fatalf("module: %v", err)
	}
	var pageID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.course_structure_items (course_id, sort_order, kind, title, parent_id, published) VALUES ($1, 0, 'content_page', 'Hello page', $2, true) RETURNING id
`, bpID, modID).Scan(&pageID); err != nil {
		t.Fatalf("page: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO course.module_content_pages (structure_item_id, markdown) VALUES ($1, '# Hi')
`, pageID); err != nil {
		t.Fatalf("mod page body: %v", err)
	}

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, err := signer.Sign(ctx, row.ID, em, "", "", nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer, Config: config.Config{}})
	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer "+tok)
	hdr.Set("Content-Type", "application/json")

	patchBody := []byte(`{"isBlueprint":true}`)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/courses/"+bpCode+"/blueprint", bytes.NewReader(patchBody))
	req = req.WithContext(ctx)
	req.Header = hdr.Clone()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("patch blueprint: %d %s", rr.Code, rr.Body.String())
	}

	linkBody := fmt.Sprintf(`{"childCourseCode":%q}`, chCode)
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+bpCode+"/blueprint/children", bytes.NewReader([]byte(linkBody)))
	req = req.WithContext(ctx)
	req.Header = hdr.Clone()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("link child: %d %s", rr.Code, rr.Body.String())
	}

	var nChild int64
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM course.course_structure_items WHERE course_id = $1`, chID).Scan(&nChild); err != nil {
		t.Fatal(err)
	}
	if nChild < 2 {
		t.Fatalf("expected cloned structure in child, got count=%d", nChild)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+bpCode+"/blueprint/push", nil)
	req = req.WithContext(ctx)
	req.Header = hdr.Clone()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("push: %d %s", rr.Code, rr.Body.String())
	}
	var pushOut struct {
		ChildrenTotal int `json:"childrenTotal"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&pushOut); err != nil {
		t.Fatal(err)
	}
	if pushOut.ChildrenTotal != 1 {
		t.Fatalf("childrenTotal want 1 got %d", pushOut.ChildrenTotal)
	}
}
