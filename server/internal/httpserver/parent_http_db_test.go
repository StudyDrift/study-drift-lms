package httpserver

import (
	"bytes"
	"context"
	"encoding/csv"
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
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestParentLinks_IsolationAndBulk_Pg(t *testing.T) {
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

	ts := time.Now().Format("20060102150405")

	emGA := "pl-ga-" + ts + "@e.com"
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

	emAdmin := "pl-adm-" + ts + "@e.com"
	adminRow, err := user.InsertUser(ctx, pool, emAdmin, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	adminID := uuid.MustParse(adminRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, adminID, "Student"); err != nil {
		t.Fatalf("student: %v", err)
	}
	slugAdm, err := organization.OrgSlugForUser(ctx, pool, adminID)
	if err != nil {
		t.Fatal(err)
	}

	emParent := "pl-par-" + ts + "@e.com"
	dn := "Pat Parent"
	parentRow, err := user.InsertUser(ctx, pool, emParent, ph, &dn)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	parentID := uuid.MustParse(parentRow.ID)
	if _, err := pool.Exec(ctx, `UPDATE "user".users SET account_type = 'parent' WHERE id = $1`, parentID); err != nil {
		t.Fatal(err)
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, parentID, "Student"); err != nil {
		t.Fatalf("student role: %v", err)
	}
	slugPar, err := organization.OrgSlugForUser(ctx, pool, parentID)
	if err != nil {
		t.Fatal(err)
	}

	emStu := "pl-stu-" + ts + "@e.com"
	sdn := "Sam Student"
	stuRow, err := user.InsertUser(ctx, pool, emStu, ph, &sdn)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	stuID := uuid.MustParse(stuRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, stuID, "Student"); err != nil {
		t.Fatalf("student: %v", err)
	}

	emOther := "pl-oth-" + ts + "@e.com"
	othRow, err := user.InsertUser(ctx, pool, emOther, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	othID := uuid.MustParse(othRow.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, othID, "Student"); err != nil {
		t.Fatalf("student: %v", err)
	}

	signer := auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool)
	gaTok, err := signer.Sign(ctx, gaRow.ID, emGA, defOrg.String(), slugGA, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})

	grantBody := []byte(`{"userId":"` + adminRow.ID + `","role":"org_admin"}`)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/orgs/"+defOrg.String()+"/role-grants", bytes.NewReader(grantBody))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+gaTok)
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("grant org_admin: %d %s", rr.Code, rr.Body.String())
	}

	adminTok, err := signer.Sign(ctx, adminRow.ID, emAdmin, defOrg.String(), slugAdm, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	linkBody := []byte(`{"parentUserId":"` + parentID.String() + `","studentUserId":"` + stuID.String() + `","relationship":"guardian"}`)
	rr2 := httptest.NewRecorder()
	r2 := httptest.NewRequest(http.MethodPost, "/api/v1/orgs/"+defOrg.String()+"/parent-links", bytes.NewReader(linkBody))
	r2 = r2.WithContext(ctx)
	r2.Header.Set("Authorization", "Bearer "+adminTok)
	r2.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr2, r2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("parent link: %d %s", rr2.Code, rr2.Body.String())
	}

	parentTok, err := signer.Sign(ctx, parentRow.ID, emParent, defOrg.String(), slugPar, nil)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	rr3 := httptest.NewRecorder()
	r3 := httptest.NewRequest(http.MethodGet, "/api/v1/parent/children", nil)
	r3 = r3.WithContext(ctx)
	r3.Header.Set("Authorization", "Bearer "+parentTok)
	h.ServeHTTP(rr3, r3)
	if rr3.Code != http.StatusOK {
		t.Fatalf("children: %d %s", rr3.Code, rr3.Body.String())
	}
	var ch struct {
		Children []struct {
			StudentUserID string `json:"studentUserId"`
		} `json:"children"`
	}
	if err := json.NewDecoder(rr3.Body).Decode(&ch); err != nil {
		t.Fatal(err)
	}
	if len(ch.Children) != 1 || ch.Children[0].StudentUserID != stuID.String() {
		t.Fatalf("unexpected children: %#v", ch)
	}

	rr4 := httptest.NewRecorder()
	r4 := httptest.NewRequest(http.MethodGet, "/api/v1/parent/students/"+othID.String()+"/grades", nil)
	r4 = r4.WithContext(ctx)
	r4.Header.Set("Authorization", "Bearer "+parentTok)
	h.ServeHTTP(rr4, r4)
	if rr4.Code != http.StatusForbidden {
		t.Fatalf("cross-child want 403 got %d %s", rr4.Code, rr4.Body.String())
	}

	var csvBuf bytes.Buffer
	w := csv.NewWriter(&csvBuf)
	_ = w.Write([]string{"parent_email", "student_email"})
	for i := 0; i < 3; i++ {
		pe := fmt.Sprintf("pl-bp-%s-%d@e.com", ts, i)
		se := fmt.Sprintf("pl-bs-%s-%d@e.com", ts, i)
		pr, err := user.InsertUser(ctx, pool, pe, ph, nil)
		if err != nil {
			t.Fatal(err)
		}
		sr, err := user.InsertUser(ctx, pool, se, ph, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := rbac.AssignUserRoleByName(ctx, pool, uuid.MustParse(pr.ID), "Student"); err != nil {
			t.Fatal(err)
		}
		if err := rbac.AssignUserRoleByName(ctx, pool, uuid.MustParse(sr.ID), "Student"); err != nil {
			t.Fatal(err)
		}
		_ = w.Write([]string{pe, se})
	}
	w.Flush()

	rr5 := httptest.NewRecorder()
	r5 := httptest.NewRequest(http.MethodPost, "/api/v1/orgs/"+defOrg.String()+"/parent-links/bulk", bytes.NewReader(csvBuf.Bytes()))
	r5 = r5.WithContext(ctx)
	r5.Header.Set("Authorization", "Bearer "+adminTok)
	r5.Header.Set("Content-Type", "text/csv")
	h.ServeHTTP(rr5, r5)
	if rr5.Code != http.StatusOK {
		t.Fatalf("bulk: %d %s", rr5.Code, rr5.Body.String())
	}
	var bulkOut struct {
		Created int `json:"created"`
	}
	if err := json.NewDecoder(rr5.Body).Decode(&bulkOut); err != nil {
		t.Fatal(err)
	}
	if bulkOut.Created != 3 {
		t.Fatalf("created want 3 got %d", bulkOut.Created)
	}
}
