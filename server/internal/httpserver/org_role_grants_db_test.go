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
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/orgrolegrant"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestOrgRoleGrants_OrgAdminSeesOrgCatalog_Pg(t *testing.T) {
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

	defOrg := organization.SeedDefaultOrgID
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}

	emGA := "orga-ga-" + time.Now().Format("20060102150405") + "@e.com"
	gaRow, err := user.InsertUser(ctx, pool, emGA, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	gaID := uuid.MustParse(gaRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, gaID, "Global Admin"); err != nil {
		t.Fatalf("ga: %v", err)
	}
	slugGA, err := organization.OrgSlugForUser(ctx, pool, gaID)
	if err != nil {
		t.Fatal(err)
	}

	emOrg := "orga-mem-" + time.Now().Format("20060102150405") + "@e.com"
	orgRow, err := user.InsertUser(ctx, pool, emOrg, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	orgUID := uuid.MustParse(orgRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, orgUID, "Student"); err != nil {
		t.Fatalf("student: %v", err)
	}
	slugOrg, err := organization.OrgSlugForUser(ctx, pool, orgUID)
	if err != nil {
		t.Fatal(err)
	}

	cc, err := course.RandomCourseCode()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO course.courses (course_code, title, created_by_user_id, org_id)
VALUES ($1, 'Org catalog course', $2, $3)
`, cc, gaID, defOrg); err != nil {
		t.Fatalf("course: %v", err)
	}

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	gaTok, err := signer.Sign(ctx, gaRow.ID, emGA, defOrg.String(), slugGA, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})

	grantBody := []byte(`{"userId":"` + orgRow.ID + `","role":"org_admin"}`)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/orgs/"+defOrg.String()+"/role-grants", bytes.NewReader(grantBody))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusCreated {
		t.Fatalf("grant org_admin: %d %s", rr.Code, rr.Body.String())
	}

	orgTok, err := signer.Sign(ctx, orgRow.ID, emOrg, defOrg.String(), slugOrg, nil)
	if err != nil {
		t.Fatalf("sign org: %v", err)
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/v1/orgs/"+defOrg.String()+"/courses", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+orgTok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("list org courses: %d %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Courses []struct {
			CourseCode string `json:"courseCode"`
		} `json:"courses"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range out.Courses {
		if c.CourseCode == cc {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected course %q in org catalog, got %d courses", cc, len(out.Courses))
	}
}

func TestOrgRoleGrants_OrgAdminCannotAssignOrgAdmin_Pg(t *testing.T) {
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

	defOrg := organization.SeedDefaultOrgID
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}

	emGA := "orgb-ga-" + time.Now().Format("20060102150405") + "@e.com"
	gaRow, err := user.InsertUser(ctx, pool, emGA, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	gaID := uuid.MustParse(gaRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, gaID, "Global Admin"); err != nil {
		t.Fatalf("ga: %v", err)
	}
	slugGA, err := organization.OrgSlugForUser(ctx, pool, gaID)
	if err != nil {
		t.Fatal(err)
	}

	emA := "orgb-a-" + time.Now().Format("20060102150405") + "@e.com"
	rowA, err := user.InsertUser(ctx, pool, emA, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uidA := uuid.MustParse(rowA.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, uidA, "Student"); err != nil {
		t.Fatalf("st: %v", err)
	}
	slugA, err := organization.OrgSlugForUser(ctx, pool, uidA)
	if err != nil {
		t.Fatal(err)
	}

	emB := "orgb-b-" + time.Now().Format("20060102150405") + "@e.com"
	rowB, err := user.InsertUser(ctx, pool, emB, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, uuid.MustParse(rowB.ID), "Student"); err != nil {
		t.Fatalf("st: %v", err)
	}

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	gaTok, err := signer.Sign(ctx, gaRow.ID, emGA, defOrg.String(), slugGA, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})

	grantBody := []byte(`{"userId":"` + rowA.ID + `","role":"org_admin"}`)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/orgs/"+defOrg.String()+"/role-grants", bytes.NewReader(grantBody))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusCreated {
		t.Fatalf("grant: %d %s", rr.Code, rr.Body.String())
	}

	aTok, err := signer.Sign(ctx, rowA.ID, emA, defOrg.String(), slugA, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	escalate := []byte(`{"userId":"` + rowB.ID + `","role":"org_admin"}`)
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/api/v1/orgs/"+defOrg.String()+"/role-grants", bytes.NewReader(escalate))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+aTok)
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for org_admin assigning org_admin, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestOrgRoleGrants_ExpiredRemovedOnList_Pg(t *testing.T) {
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

	defOrg := organization.SeedDefaultOrgID
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}

	emGA := "orgx-ga-" + time.Now().Format("20060102150405") + "@e.com"
	gaRow, err := user.InsertUser(ctx, pool, emGA, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	gaID := uuid.MustParse(gaRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, gaID, "Global Admin"); err != nil {
		t.Fatalf("ga: %v", err)
	}
	slugGA, err := organization.OrgSlugForUser(ctx, pool, gaID)
	if err != nil {
		t.Fatal(err)
	}

	emT := "orgx-t-" + time.Now().Format("20060102150405") + "@e.com"
	tRow, err := user.InsertUser(ctx, pool, emT, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	tUID := uuid.MustParse(tRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, tUID, "Student"); err != nil {
		t.Fatalf("st: %v", err)
	}

	_, err = pool.Exec(ctx, `
INSERT INTO tenant.org_role_grants (org_id, user_id, org_unit_id, role, granted_by, granted_at, expires_at)
VALUES ($1, $2, NULL, $3, $4, now() - interval '1 hour', now() - interval '1 minute')
`, defOrg, tUID, orgrolegrant.RoleOrgViewer, gaID)
	if err != nil {
		t.Fatalf("insert expired: %v", err)
	}

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	gaTok, err := signer.Sign(ctx, gaRow.ID, emGA, defOrg.String(), slugGA, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})

	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/orgs/"+defOrg.String()+"/role-grants", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("list grants: %d %s", rr.Code, rr.Body.String())
	}
	var listed struct {
		Grants []any `json:"grants"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	for _, g := range listed.Grants {
		t.Fatalf("expected no grants after expiry prune, got %+v", g)
	}
}

func TestOrgRoleGrants_StudentCannotListGrants_Pg(t *testing.T) {
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

	defOrg := organization.SeedDefaultOrgID
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	em := "orgs-st-" + time.Now().Format("20060102150405") + "@e.com"
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, uuid.MustParse(row.ID), "Student"); err != nil {
		t.Fatalf("st: %v", err)
	}
	slug, err := organization.OrgSlugForUser(ctx, pool, uuid.MustParse(row.ID))
	if err != nil {
		t.Fatal(err)
	}
	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	tok, err := signer.Sign(ctx, row.ID, em, defOrg.String(), slug, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/orgs/"+defOrg.String()+"/role-grants", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}
