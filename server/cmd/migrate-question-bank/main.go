// Command migrate-question-bank syncs legacy module_quizzes JSON into course.questions + quiz_question_refs
// for every quiz in a course (Rust `server/src/bin/migrate_question_bank.rs`).
//
// Usage: RUN_MIGRATIONS=1 ALLOW_INSECURE_JWT=1 DATABASE_URL=... go run ./cmd/migrate-question-bank -- <course_code>
package main

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"os"

	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursemodulequizzes"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/repos/questionbank"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: migrate-question-bank <course_code>")
		os.Exit(2)
	}
	courseCode := os.Args[1]
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if cfg.RunMigrations {
		if err := migrate.RunWithFS(ctx, migrationsFS(), cfg.DatabaseURL); err != nil {
			log.Fatal(err)
		}
	}
	courseID, err := course.GetIDByCourseCode(ctx, pool, courseCode)
	if err != nil {
		log.Fatal(err)
	}
	if courseID == nil {
		log.Fatal("unknown course_code")
	}
	bankOn, _, err := course.GetImportFlags(ctx, pool, *courseID)
	if err != nil {
		log.Fatal(err)
	}
	if !bankOn {
		log.Fatal("course.question_bank_enabled must be true before running this migration")
	}
	rows, err := coursestructure.ListForCourse(ctx, pool, *courseID)
	if err != nil {
		log.Fatal(err)
	}
	var n int
	for _, it := range rows {
		if it.Kind != "quiz" {
			continue
		}
		qz, err := coursemodulequizzes.GetForCourseItem(ctx, pool, *courseID, it.ID)
		if err != nil {
			log.Fatal(err)
		}
		if qz == nil || len(qz.Questions) == 0 {
			continue
		}
		if err := questionbank.SyncQuizRefsFromEditorJSON(ctx, pool, *courseID, it.ID, qz.Questions, nil); err != nil {
			log.Fatalf("sync structure_item_id=%s: %v", it.ID, err)
		}
		n++
		fmt.Fprintf(os.Stderr, "synced quiz structure_item_id=%s\n", it.ID)
	}
	fmt.Fprintf(os.Stderr, "done: %d quizzes synced for %s\n", n, courseCode)
}

func migrationsFS() fs.FS {
	return serverdata.Migrations
}
