// Command hydrate-welcome-course creates the default "Getting started with Lextures" onboarding course
// for a user (student enrollment), optional staff teachers, module content, assignment, quiz,
// per-course permission grants, and baseline Student / Teacher app role links.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server-new"
	"github.com/lextures/lextures/server-new/internal/db"
	"github.com/lextures/lextures/server-new/internal/migrate"
	"github.com/lextures/lextures/server-new/internal/scripts/welcomecourse"
)

func main() {
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	runMig := flag.Bool("migrate", false, "apply embedded SQL migrations before hydrating (uses DATABASE_URL)")
	student := flag.String("student-user-id", "", "UUID of the learner to enroll as student (required)")
	teachers := flag.String("teacher-user-ids", "", "comma-separated teacher UUIDs for roster + grants; omit to use the student in solo mode")
	flag.Parse()

	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	sid, err := uuid.Parse(strings.TrimSpace(*student))
	if err != nil || sid == uuid.Nil {
		log.Fatal("-student-user-id must be a non-empty UUID")
	}

	ctx := context.Background()
	if *runMig {
		if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
			log.Fatalf("migrate: %v", err)
		}
	}

	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	var teacherIDs []uuid.UUID
	for _, part := range strings.Split(*teachers, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		tid, perr := uuid.Parse(part)
		if perr != nil {
			log.Fatalf("invalid teacher uuid %q: %v", part, perr)
		}
		teacherIDs = append(teacherIDs, tid)
	}

	res, err := welcomecourse.Hydrate(ctx, pool, sid, teacherIDs)
	if err != nil {
		log.Fatalf("hydrate: %v", err)
	}

	action := "reused existing"
	if res.Created {
		action = "created"
	}
	fmt.Printf("%s welcome course %s (course_code=%s course_id=%s)\n", action, welcomecourse.DefaultTitle(), res.CourseCode, res.CourseID)
}
