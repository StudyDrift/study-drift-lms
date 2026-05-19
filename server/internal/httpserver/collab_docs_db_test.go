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
	"github.com/lextures/lextures/server/internal/courseroles"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestCollabDocs_FullCRUD_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
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

	em := "collab-" + time.Now().Format("20060102150405.000") + "@test.com"
	ph, _ := auth.HashPassword("longpassword0longpassword0")
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	cc := fmt.Sprintf("CLAB%05d", time.Now().UnixNano()%100000)

	var courseID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'Collab Test', $2) RETURNING id`,
		cc, uid,
	).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}
	// Enable feature.
	if _, err := pool.Exec(ctx, `UPDATE course.courses SET collab_docs_enabled = true WHERE id = $1`, courseID); err != nil {
		t.Fatalf("enable: %v", err)
	}
	// Enroll as teacher.
	if _, err := pool.Exec(ctx,
		`INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'teacher')`,
		courseID, uid,
	); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, uid, courseID, cc); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("grants: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, _ := signer.Sign(ctx, row.ID, em, "", "", nil)
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer, Config: config.Config{}})

	// --- List (empty) ---
	{
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/collab-docs", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("list empty: %d %s", rr.Code, rr.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		docs, _ := body["docs"].([]any)
		if len(docs) != 0 {
			t.Fatalf("expected empty list, got %d", len(docs))
		}
	}

	// --- Create ---
	var docID string
	{
		b, _ := json.Marshal(map[string]any{"title": "My Collab Doc", "docType": "rich_text"})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+cc+"/collab-docs", bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		docID, _ = body["id"].(string)
		if docID == "" {
			t.Fatal("create: missing id in response")
		}
		if body["title"] != "My Collab Doc" {
			t.Fatalf("create: wrong title %v", body["title"])
		}
		if body["docType"] != "rich_text" {
			t.Fatalf("create: wrong docType %v", body["docType"])
		}
	}

	// --- Get ---
	{
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/collab-docs/"+docID, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("get: %d %s", rr.Code, rr.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		if body["id"] != docID {
			t.Fatalf("get: wrong id %v", body["id"])
		}
	}

	// --- List (one item) ---
	{
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/collab-docs", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("list one: %d %s", rr.Code, rr.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		docs, _ := body["docs"].([]any)
		if len(docs) != 1 {
			t.Fatalf("expected 1 doc, got %d", len(docs))
		}
	}

	// --- Patch title ---
	{
		b, _ := json.Marshal(map[string]any{"title": "Renamed Doc"})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/courses/"+cc+"/collab-docs/"+docID, bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("patch: %d %s", rr.Code, rr.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		if body["title"] != "Renamed Doc" {
			t.Fatalf("patch: wrong title %v", body["title"])
		}
	}

	// --- Snapshots (empty) ---
	{
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/collab-docs/"+docID+"/snapshots", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("snapshots: %d %s", rr.Code, rr.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		snaps, _ := body["snapshots"].([]any)
		if len(snaps) != 0 {
			t.Fatalf("expected empty snapshots, got %d", len(snaps))
		}
	}

	// --- Delete ---
	{
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/courses/"+cc+"/collab-docs/"+docID, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("delete: %d %s", rr.Code, rr.Body.String())
		}
	}

	// --- Get after delete (404) ---
	{
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/collab-docs/"+docID, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("get after delete: expected 404 got %d", rr.Code)
		}
	}
}

func TestCollabDocs_FeatureGate_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
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

	em := "collab-gate-" + time.Now().Format("20060102150405.000") + "@test.com"
	ph, _ := auth.HashPassword("longpassword0longpassword0")
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	cc := fmt.Sprintf("CLBG%05d", time.Now().UnixNano()%100000)

	var courseID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'Gate Test', $2) RETURNING id`,
		cc, uid,
	).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}
	// Feature disabled (default).
	if _, err := pool.Exec(ctx,
		`INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'teacher')`,
		courseID, uid,
	); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, uid, courseID, cc); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("grants: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, _ := signer.Sign(ctx, row.ID, em, "", "", nil)
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer, Config: config.Config{}})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/collab-docs", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("gate: expected 404 when feature disabled, got %d %s", rr.Code, rr.Body.String())
	}

	// Enable via features endpoint.
	{
		b, _ := json.Marshal(map[string]any{
			"notebookEnabled":   true,
			"feedEnabled":       false,
			"calendarEnabled":   true,
			"questionBankEnabled": false,
			"lockdownModeEnabled": false,
			"discussionsEnabled":  false,
			"collabDocsEnabled":   true,
		})
		rr2 := httptest.NewRecorder()
		req2 := httptest.NewRequest(http.MethodPatch, "/api/v1/courses/"+cc+"/features", bytes.NewReader(b))
		req2.Header.Set("Authorization", "Bearer "+tok)
		req2.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rr2, req2)
		if rr2.Code != http.StatusOK {
			t.Fatalf("enable via features: %d %s", rr2.Code, rr2.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rr2.Body.Bytes(), &body)
		if body["collabDocsEnabled"] != true {
			t.Fatalf("expected collabDocsEnabled=true in response, got %v", body["collabDocsEnabled"])
		}
	}

	// Now list should succeed.
	rr3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/collab-docs", nil)
	req3.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr3, req3)
	if rr3.Code != http.StatusOK {
		t.Fatalf("list after enable: %d %s", rr3.Code, rr3.Body.String())
	}
}

func TestCollabDocs_InvalidDocType_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
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

	em := "collab-type-" + time.Now().Format("20060102150405.000") + "@test.com"
	ph, _ := auth.HashPassword("longpassword0longpassword0")
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	cc := fmt.Sprintf("CLBT%05d", time.Now().UnixNano()%100000)

	var courseID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'Type Test', $2) RETURNING id`,
		cc, uid,
	).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE course.courses SET collab_docs_enabled = true WHERE id = $1`, courseID); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'teacher')`,
		courseID, uid,
	); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	tx, _ := pool.Begin(ctx)
	_ = courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, uid, courseID, cc)
	_ = tx.Commit(ctx)

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, _ := signer.Sign(ctx, row.ID, em, "", "", nil)
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer, Config: config.Config{}})

	b, _ := json.Marshal(map[string]any{"title": "Bad Type", "docType": "pdf"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+cc+"/collab-docs", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("bad docType: expected 400 got %d %s", rr.Code, rr.Body.String())
	}
}
