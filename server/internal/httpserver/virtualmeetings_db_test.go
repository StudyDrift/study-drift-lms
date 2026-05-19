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
	"github.com/lextures/lextures/server/internal/repos/virtualmeetings"
)

func setupVirtualMeetingTest(t *testing.T) (
	h http.Handler,
	teacherTok, studentTok string,
	courseCode string,
	courseID uuid.UUID,
	cleanup func(),
) {
	t.Helper()
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	dsn := os.Getenv("DATABASE_URL")
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		cancel()
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		cancel()
		t.Fatalf("pool: %v", err)
	}

	suffix := fmt.Sprintf("%05d", time.Now().UnixNano()%100000)
	teacherEmail := "vm-teacher-" + suffix + "@e.com"
	studentEmail := "vm-student-" + suffix + "@e.com"
	ph, _ := auth.HashPassword("longpassword0longpassword0")

	teacherRow, err := user.InsertUser(ctx, pool, teacherEmail, ph, nil)
	if err != nil {
		cancel()
		t.Fatalf("teacher user: %v", err)
	}
	studentRow, err := user.InsertUser(ctx, pool, studentEmail, ph, nil)
	if err != nil {
		cancel()
		t.Fatalf("student user: %v", err)
	}

	teacherUID, _ := uuid.Parse(teacherRow.ID)
	studentUID, _ := uuid.Parse(studentRow.ID)

	cc := fmt.Sprintf("C-V%s", suffix)
	if err := pool.QueryRow(ctx,
		`INSERT INTO course.courses (course_code, title, created_by_user_id) VALUES ($1, 'VM Test', $2) RETURNING id`,
		cc, teacherUID,
	).Scan(&courseID); err != nil {
		cancel()
		t.Fatalf("course: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'teacher')`,
		courseID, teacherUID,
	); err != nil {
		cancel()
		t.Fatalf("teacher enroll: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'student')`,
		courseID, studentUID,
	); err != nil {
		cancel()
		t.Fatalf("student enroll: %v", err)
	}

	tx, _ := pool.Begin(ctx)
	_ = courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, teacherUID, courseID, cc)
	_ = tx.Commit(ctx)

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tTok, _ := signer.Sign(ctx, teacherRow.ID, teacherEmail, "", "", nil)
	sTok, _ := signer.Sign(ctx, studentRow.ID, studentEmail, "", "", nil)

	deps := Deps{
		Pool:      pool,
		JWTSigner: signer,
		Config:    config.Config{VirtualClassroomEnabled: true},
	}
	handler := NewHandler(deps)

	return handler, tTok, sTok, cc, courseID, func() {
		pool.Close()
		cancel()
	}
}

func TestVirtualMeetings_CreateAndList_Pg(t *testing.T) {
	h, teacherTok, studentTok, cc, _, cleanup := setupVirtualMeetingTest(t)
	defer cleanup()
	ctx := context.Background()

	// Student cannot create a meeting.
	body := map[string]any{"title": "Weekly Lecture", "provider": "jitsi"}
	b, _ := json.Marshal(body)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+cc+"/meetings", bytes.NewReader(b))
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+studentTok)
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("student create: want 403, got %d %s", rr.Code, rr.Body.String())
	}

	// Teacher can create a meeting.
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/courses/"+cc+"/meetings", bytes.NewReader(b))
	req2 = req2.WithContext(ctx)
	req2.Header.Set("Authorization", "Bearer "+teacherTok)
	req2.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusCreated {
		t.Fatalf("teacher create: want 201, got %d %s", rr2.Code, rr2.Body.String())
	}
	var created virtualmeetings.Meeting
	if err := json.NewDecoder(rr2.Body).Decode(&created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if created.Title != "Weekly Lecture" {
		t.Fatalf("title: %q", created.Title)
	}
	if created.JoinURL == nil || *created.JoinURL == "" {
		t.Fatal("joinUrl should be set for jitsi")
	}

	// Both teacher and student can list meetings.
	for _, tok := range []string{teacherTok, studentTok} {
		rr3 := httptest.NewRecorder()
		req3 := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/meetings", nil)
		req3 = req3.WithContext(ctx)
		req3.Header.Set("Authorization", "Bearer "+tok)
		h.ServeHTTP(rr3, req3)
		if rr3.Code != http.StatusOK {
			t.Fatalf("list: want 200, got %d", rr3.Code)
		}
		var resp map[string]interface{}
		_ = json.NewDecoder(rr3.Body).Decode(&resp)
		meetings, ok := resp["meetings"].([]interface{})
		if !ok || len(meetings) == 0 {
			t.Fatal("expected at least one meeting in list")
		}
	}
}

func TestVirtualMeetings_Patch_Pg(t *testing.T) {
	h, teacherTok, studentTok, cc, courseID, cleanup := setupVirtualMeetingTest(t)
	defer cleanup()
	ctx := context.Background()

	// Create a meeting directly via repo.
	pool, err := db.NewPool(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Skip("pool")
	}
	defer pool.Close()

	m, err := virtualmeetings.Create(ctx, pool, courseID, courseID /* reuse as createdBy */, "jitsi", "Old Title", nil, nil, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Student cannot patch.
	patch := map[string]any{"title": "New Title"}
	pb, _ := json.Marshal(patch)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/meetings/"+m.ID, bytes.NewReader(pb))
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+studentTok)
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("student patch: want 403, got %d", rr.Code)
	}

	// Teacher can patch.
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPatch, "/api/v1/meetings/"+m.ID, bytes.NewReader(pb))
	req2 = req2.WithContext(ctx)
	req2.Header.Set("Authorization", "Bearer "+teacherTok)
	req2.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("teacher patch: want 200, got %d %s", rr2.Code, rr2.Body.String())
	}
	var updated virtualmeetings.Meeting
	_ = json.NewDecoder(rr2.Body).Decode(&updated)
	if updated.Title != "New Title" {
		t.Fatalf("title after patch: %q", updated.Title)
	}

	// Teacher can cancel (status = cancelled).
	cancel := map[string]any{"status": "cancelled"}
	cb, _ := json.Marshal(cancel)
	rr3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodPatch, "/api/v1/meetings/"+m.ID, bytes.NewReader(cb))
	req3 = req3.WithContext(ctx)
	req3.Header.Set("Authorization", "Bearer "+teacherTok)
	req3.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr3, req3)
	if rr3.Code != http.StatusOK {
		t.Fatalf("cancel: want 200, got %d %s", rr3.Code, rr3.Body.String())
	}
	var cancelled virtualmeetings.Meeting
	_ = json.NewDecoder(rr3.Body).Decode(&cancelled)
	if cancelled.Status != "cancelled" {
		t.Fatalf("status after cancel: %q", cancelled.Status)
	}

	// Cancelled meeting no longer appears in the list.
	rr4 := httptest.NewRecorder()
	req4 := httptest.NewRequest(http.MethodGet, "/api/v1/courses/"+cc+"/meetings", nil)
	req4 = req4.WithContext(ctx)
	req4.Header.Set("Authorization", "Bearer "+teacherTok)
	h.ServeHTTP(rr4, req4)
	var listResp map[string]interface{}
	_ = json.NewDecoder(rr4.Body).Decode(&listResp)
	meetings, _ := listResp["meetings"].([]interface{})
	for _, raw := range meetings {
		m2, _ := raw.(map[string]interface{})
		if m2["id"] == m.ID {
			t.Fatal("cancelled meeting should not appear in list")
		}
	}
}

func TestVirtualMeetings_Ical_Pg(t *testing.T) {
	h, teacherTok, _, cc, courseID, cleanup := setupVirtualMeetingTest(t)
	defer cleanup()
	ctx := context.Background()

	pool, err := db.NewPool(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Skip("pool")
	}
	defer pool.Close()

	start := time.Now().Add(10 * time.Minute).UTC()
	end := start.Add(time.Hour)
	m, err := virtualmeetings.Create(ctx, pool, courseID, courseID, "jitsi", "Lecture 1", &start, &end, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Skip the list test for this course since the meeting is in a separate pool
	_ = cc

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/meetings/"+m.ID+"/ical", nil)
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+teacherTok)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("ical: want 200, got %d %s", rr.Code, rr.Body.String())
	}
	ct := rr.Header().Get("Content-Type")
	if ct == "" || ct[:13] != "text/calendar" {
		t.Fatalf("content-type: %q", ct)
	}
	body := rr.Body.String()
	if !containsSubstring(body, "BEGIN:VCALENDAR") {
		t.Fatal("missing BEGIN:VCALENDAR")
	}
	if !containsSubstring(body, "BEGIN:VEVENT") {
		t.Fatal("missing BEGIN:VEVENT")
	}
	if !containsSubstring(body, "Lecture 1") {
		t.Fatal("missing meeting title in ical")
	}
}

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || func() bool {
		for i := 0; i <= len(s)-len(sub); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	}())
}
