package welcomecourse

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestHydrate_Pg(t *testing.T) {
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

	ph, err := auth.HashPassword("password1230")
	if err != nil {
		t.Fatal(err)
	}
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	stu, err := user.InsertUser(ctx, pool, "welcome-stu-"+suffix+"@t.com", ph, nil)
	if err != nil {
		t.Fatalf("insert student: %v", err)
	}
	tch, err := user.InsertUser(ctx, pool, "welcome-tch-"+suffix+"@t.org", ph, nil)
	if err != nil {
		t.Fatalf("insert teacher: %v", err)
	}

	stuID := uuid.MustParse(stu.ID)
	tchID := uuid.MustParse(tch.ID)

	res1, err := Hydrate(ctx, pool, stuID, []uuid.UUID{tchID})
	if err != nil {
		t.Fatalf("hydrate 1: %v", err)
	}
	if !res1.Created {
		t.Fatalf("first hydrate: want created true")
	}

	res2, err := Hydrate(ctx, pool, stuID, []uuid.UUID{tchID})
	if err != nil {
		t.Fatalf("hydrate 2: %v", err)
	}
	if res2.Created {
		t.Fatalf("second hydrate: want created false")
	}
	if res2.CourseID != res1.CourseID || res2.CourseCode != res1.CourseCode {
		t.Fatalf("id mismatch: %+v vs %+v", res1, res2)
	}

	var nPages, nAssign, nQuiz int
	_ = pool.QueryRow(ctx, `
SELECT
  (SELECT COUNT(*) FROM course.course_structure_items i
   INNER JOIN course.module_content_pages p ON p.structure_item_id = i.id
   WHERE i.course_id = $1 AND i.kind = 'content_page'),
  (SELECT COUNT(*) FROM course.course_structure_items i
   INNER JOIN course.module_assignments a ON a.structure_item_id = i.id
   WHERE i.course_id = $1 AND i.kind = 'assignment'),
  (SELECT COUNT(*) FROM course.course_structure_items i
   INNER JOIN course.module_quizzes q ON q.structure_item_id = i.id
   WHERE i.course_id = $1 AND i.kind = 'quiz')
`, res1.CourseID).Scan(&nPages, &nAssign, &nQuiz)
	if nPages != 2 || nAssign != 1 || nQuiz != 1 {
		t.Fatalf("structure counts: pages=%d assign=%d quiz=%d", nPages, nAssign, nQuiz)
	}

	var grantCount int
	err = pool.QueryRow(ctx, `
SELECT COUNT(*) FROM course.user_course_grants WHERE course_id = $1 AND user_id = $2
`, res1.CourseID, tchID).Scan(&grantCount)
	if err != nil {
		t.Fatal(err)
	}
	if grantCount < 5 {
		t.Fatalf("teacher grants: got %d want >= 5", grantCount)
	}
}
