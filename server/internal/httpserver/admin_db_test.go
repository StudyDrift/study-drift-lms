package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
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
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/orgunit"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestAdmin_OIDCList_OK_Pg(t *testing.T) {
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
	em := "admn-" + time.Now().Format("20060102150405") + "@e.com"
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
	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, err := signer.Sign(ctx, row.ID, em, "", "", nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/oidc/providers", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("ok: %d %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Providers []any `json:"providers"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Providers == nil {
		t.Fatal("expected providers array")
	}
}

func TestAdmin_Forbidden_WithoutGA_Pg(t *testing.T) {
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
	em := "noga-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, uuid.MustParse(row.ID), "Student"); err != nil {
		t.Fatalf("st: %v", err)
	}
	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, err := signer.Sign(ctx, row.ID, em, "", "", nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/oidc/providers", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("forbidden: %d", rr.Code)
	}
}

func TestAdminOrganizations_CRUD_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
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
	em := "orgs-" + time.Now().Format("20060102150405") + "@e.com"
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
	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, err := signer.Sign(ctx, row.ID, em, "", "", nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})

	slug := "t-org-" + time.Now().Format("150405")
	createBody := []byte(`{"name":"Test Tenant Org","slug":"` + slug + `"}`)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/orgs", bytes.NewReader(createBody))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create org: %d %s", rr.Code, rr.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" {
		t.Fatal("missing id")
	}

	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/v1/admin/orgs", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: %d", rr.Code)
	}
}

func TestAdminOrgUnits_Tree_Delete409_ListScope_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
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

	em := "ouadm-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	gaRow, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	gaID := uuid.MustParse(gaRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, gaID, "Global Admin"); err != nil {
		t.Fatalf("ga: %v", err)
	}
	defOrg := organization.SeedDefaultOrgID
	slug, err := organization.OrgSlugForUser(ctx, pool, gaID)
	if err != nil {
		t.Fatal(err)
	}
	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	gaTok, err := signer.Sign(ctx, gaRow.ID, em, defOrg.String(), slug, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})

	// Root + child units
	suffix := time.Now().Format("150405")
	parentName := "Lincoln High " + suffix
	postParent := []byte(`{"name":"` + parentName + `","unitType":"school"}`)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/orgs/"+defOrg.String()+"/units", bytes.NewReader(postParent))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create parent: %d %s", rr.Code, rr.Body.String())
	}
	var parent struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&parent); err != nil {
		t.Fatal(err)
	}
	pid := uuid.MustParse(parent.ID)

	childBody := []byte(`{"name":"Math Dept","unitType":"department"}`)
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/api/v1/admin/orgs/"+defOrg.String()+"/units/"+pid.String()+"/children", bytes.NewReader(childBody))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create child: %d %s", rr.Code, rr.Body.String())
	}
	var child struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&child); err != nil {
		t.Fatal(err)
	}
	cid := uuid.MustParse(child.ID)

	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/v1/admin/orgs/"+defOrg.String()+"/units/tree", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("tree: %d %s", rr.Code, rr.Body.String())
	}
	var tree struct {
		Tree []struct {
			Name     string `json:"name"`
			Children []struct {
				Name string `json:"name"`
			} `json:"children"`
		} `json:"tree"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&tree); err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, root := range tree.Tree {
		if root.Name == parentName {
			found = true
			if len(root.Children) != 1 || root.Children[0].Name != "Math Dept" {
				t.Fatalf("unexpected children for %q: %+v", parentName, root.Children)
			}
			break
		}
	}
	if !found {
		t.Fatalf("tree missing %q: %+v", parentName, tree.Tree)
	}

	// Course in child unit — delete parent should 409 (has child) first delete child with course
	cc, err := course.RandomCourseCode()
	if err != nil {
		t.Fatal(err)
	}
	var courseID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id, org_id, org_unit_id)
VALUES ($1, 'U', $2, $3, $4) RETURNING id
`, cc, gaID, defOrg, cid).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}

	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/orgs/"+defOrg.String()+"/units/"+cid.String(), nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusConflict {
		t.Fatalf("delete with course: %d %s", rr.Code, rr.Body.String())
	}

	if _, err := pool.Exec(ctx, `UPDATE course.courses SET org_unit_id = NULL WHERE id = $1`, courseID); err != nil {
		t.Fatal(err)
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/orgs/"+defOrg.String()+"/units/"+cid.String(), nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("delete child: %d %s", rr.Code, rr.Body.String())
	}

	// Unit-scoped admin: courses under assigned unit subtree only (sibling root unit excluded)
	emP := "prin-" + time.Now().Format("20060102150405") + "@e.com"
	rowP, err := user.InsertUser(ctx, pool, emP, ph, nil)
	if err != nil {
		t.Fatalf("user2: %v", err)
	}
	princID := uuid.MustParse(rowP.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, princID, "Org Unit Admin"); err != nil {
		t.Fatalf("ou role: %v", err)
	}
	if err := orgunit.AssignOrgUnitAdmin(ctx, pool, princID, pid); err != nil {
		t.Fatalf("assign unit: %v", err)
	}
	slugP, err := organization.OrgSlugForUser(ctx, pool, princID)
	if err != nil {
		t.Fatal(err)
	}
	princTok, err := signer.Sign(ctx, rowP.ID, emP, defOrg.String(), slugP, nil)
	if err != nil {
		t.Fatalf("sign2: %v", err)
	}

	// Sibling root unit (not under pid) with a course — must not appear for principal of pid
	postOther := []byte(`{"name":"Central High ` + suffix + `","unitType":"school"}`)
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/api/v1/admin/orgs/"+defOrg.String()+"/units", bytes.NewReader(postOther))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create other root: %d %s", rr.Code, rr.Body.String())
	}
	var otherRoot struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&otherRoot); err != nil {
		t.Fatal(err)
	}
	otherID := uuid.MustParse(otherRoot.ID)

	ccA, err := course.RandomCourseCode()
	if err != nil {
		t.Fatal(err)
	}
	ccB, err := course.RandomCourseCode()
	if err != nil {
		t.Fatal(err)
	}
	var idA, idB uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id, org_id, org_unit_id)
VALUES ($1, 'InA', $2, $3, $4) RETURNING id
`, ccA, princID, defOrg, pid).Scan(&idA); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id, org_id, org_unit_id)
VALUES ($1, 'InB', $2, $3, $4) RETURNING id
`, ccB, princID, defOrg, otherID).Scan(&idB); err != nil {
		t.Fatal(err)
	}
	for _, xid := range []struct {
		cid uuid.UUID
		uid uuid.UUID
	}{{idA, princID}, {idB, princID}} {
		if _, err := pool.Exec(ctx, `INSERT INTO course.course_enrollments (course_id, user_id, role, active) VALUES ($1, $2, 'student', true)`, xid.cid, xid.uid); err != nil {
			t.Fatal(err)
		}
	}

	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/v1/courses", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+princTok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("list courses: %d %s", rr.Code, rr.Body.String())
	}
	var list struct {
		Courses []struct {
			CourseCode string `json:"courseCode"`
		} `json:"courses"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	if len(list.Courses) != 1 || list.Courses[0].CourseCode != ccA {
		t.Fatalf("expected one course in unit subtree, got %+v", list.Courses)
	}
}

func TestEnrollment_OrgIsolation_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
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

	var otherOrg uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO tenant.organizations (slug, name, status)
VALUES ($1, $2, 'active') RETURNING id
`, "iso-"+time.Now().Format("150405"), "Isolation Org").Scan(&otherOrg); err != nil {
		t.Fatalf("org: %v", err)
	}

	em := "iso-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	urow, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid := uuid.MustParse(urow.ID)

	courseCode, err := course.RandomCourseCode()
	if err != nil {
		t.Fatal(err)
	}
	var courseID uuid.UUID
	if err := pool.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id, org_id)
VALUES ($1, 'Iso', $2, $3) RETURNING id
`, courseCode, uid, otherOrg).Scan(&courseID); err != nil {
		t.Fatalf("course: %v", err)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO course.course_enrollments (course_id, user_id, role) VALUES ($1, $2, 'student')`, courseID, uid); err != nil {
		t.Fatalf("enroll: %v", err)
	}

	ok, err := enrollment.UserHasAccess(ctx, pool, courseCode, uid)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected no cross-org access via stale enrollment row")
	}
}
