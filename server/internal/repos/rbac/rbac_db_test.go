package rbac

import (
	"context"
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

func TestAssignUserRoleByName_Pg(t *testing.T) {
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
	em := "rbac-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := AssignUserRoleByName(ctx, pool, uid, "Student"); err != nil {
		t.Fatalf("assign: %v", err)
	}
}

func TestListRolesWithPermissions_Pg(t *testing.T) {
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
	roles, err := ListRolesWithPermissions(ctx, pool)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(roles) < 1 {
		t.Fatal("expected at least one app role from migrations")
	}
}

// TestProvisioningRoleMap_Pg verifies that migration 143 seeds the provisioning_role_map
// and that LookupProvisioningRole resolves known provider+externalRole pairs.
func TestProvisioningRoleMap_Pg(t *testing.T) {
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

	tests := []struct {
		provider     string
		externalRole string
		wantName     string
	}{
		{"clever", "teacher", "Teacher"},
		{"clever", "student", "Student"},
		{"oneroster", "teacher", "Teacher"},
		{"oneroster", "student", "Student"},
		{"saml", "teacher", "Teacher"},
	}
	for _, tc := range tests {
		res, err := LookupProvisioningRole(ctx, pool, tc.provider, tc.externalRole)
		if err != nil {
			t.Errorf("LookupProvisioningRole(%q,%q): %v", tc.provider, tc.externalRole, err)
			continue
		}
		if res == nil {
			t.Errorf("LookupProvisioningRole(%q,%q): got nil, want %q", tc.provider, tc.externalRole, tc.wantName)
			continue
		}
		if res.AppRoleName != tc.wantName {
			t.Errorf("LookupProvisioningRole(%q,%q): got %q, want %q", tc.provider, tc.externalRole, res.AppRoleName, tc.wantName)
		}
	}

	// Unknown mapping should return nil, no error.
	res, err := LookupProvisioningRole(ctx, pool, "clever", "unknown-role-xyz")
	if err != nil {
		t.Fatalf("unknown role: %v", err)
	}
	if res != nil {
		t.Fatalf("unknown role: expected nil, got %+v", res)
	}
}

// TestAssignUserRoleFromProvisioningMap_Pg verifies that a user gets the correct app role
// via the provisioning_role_map and falls back gracefully when no mapping exists.
func TestAssignUserRoleFromProvisioningMap_Pg(t *testing.T) {
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

	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}

	// User resolved via provisioning_role_map
	em1 := "prov-map-teacher-" + time.Now().Format("20060102150405.999") + "@e.com"
	row1, err := user.InsertUser(ctx, pool, em1, ph, nil)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	uid1, _ := uuid.Parse(row1.ID)
	roleName, err := AssignUserRoleFromProvisioningMap(ctx, pool, uid1, "clever", "teacher", "Student")
	if err != nil {
		t.Fatalf("assign: %v", err)
	}
	if roleName != "Teacher" {
		t.Fatalf("expected Teacher, got %q", roleName)
	}

	// Fallback when mapping missing
	em2 := "prov-map-fallback-" + time.Now().Format("20060102150405.999") + "@e.com"
	row2, err := user.InsertUser(ctx, pool, em2, ph, nil)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	uid2, _ := uuid.Parse(row2.ID)
	roleName2, err := AssignUserRoleFromProvisioningMap(ctx, pool, uid2, "clever", "no-such-role", "Student")
	if err != nil {
		t.Fatalf("assign fallback: %v", err)
	}
	if roleName2 != "Student" {
		t.Fatalf("expected Student fallback, got %q", roleName2)
	}
}

// TestEnrollmentCapabilityBits_Pg verifies that migration 143 correctly set is_staff
// and is_student_equivalent on the enrollment_roles catalog.
func TestEnrollmentCapabilityBits_Pg(t *testing.T) {
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

	type roleBits struct {
		isStaff     bool
		isStudentEq bool
	}
	rows, err := pool.Query(ctx, `
SELECT role_key, is_staff, is_student_equivalent
FROM course.enrollment_roles
ORDER BY role_key
`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	bits := make(map[string]roleBits)
	for rows.Next() {
		var k string
		var b roleBits
		if err := rows.Scan(&k, &b.isStaff, &b.isStudentEq); err != nil {
			t.Fatalf("scan: %v", err)
		}
		bits[k] = b
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}

	staffRoles := []string{"teacher", "instructor", "owner", "ta", "designer", "observer", "auditor", "librarian"}
	for _, r := range staffRoles {
		b, ok := bits[r]
		if !ok {
			t.Errorf("role %q missing from catalog", r)
			continue
		}
		if !b.isStaff {
			t.Errorf("role %q: expected is_staff=true", r)
		}
		if b.isStudentEq {
			t.Errorf("role %q: expected is_student_equivalent=false", r)
		}
	}

	studentBits, ok := bits["student"]
	if !ok {
		t.Fatal("role 'student' missing from catalog")
	}
	if studentBits.isStaff {
		t.Error("role 'student': expected is_staff=false")
	}
	if !studentBits.isStudentEq {
		t.Error("role 'student': expected is_student_equivalent=true")
	}
}
