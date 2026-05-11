// Command bootstrap-admin grants Global Admin to an existing user by email (operator tool).
// Use when BOOTSTRAP_ADMIN_EMAIL was unset at first signup or to promote an account after deploy.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func main() {
	emailArg := flag.String("email", "", "user email to grant Global Admin (required)")
	flag.Parse()
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	em := user.NormalizeEmail(*emailArg)
	if em == "" {
		log.Fatal("-email is required and must be a valid address")
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	row, err := user.FindByEmail(ctx, pool, em)
	if err != nil {
		log.Fatalf("lookup: %v", err)
	}
	if row == nil {
		log.Fatalf("no user with email %q", em)
	}
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		log.Fatalf("user id: %v", err)
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, uid, "Global Admin"); err != nil {
		log.Fatalf("rbac: %v", err)
	}
	fmt.Printf("Global Admin granted to %s (%s)\n", em, row.ID)
}
