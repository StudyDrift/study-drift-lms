package coursesyllabus

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/repos/course"
)

type SyllabusSection = course.SyllabusSection
type SyllabusPayload = course.SyllabusPayload

func GetSyllabusByCourseCode(ctx context.Context, pool *pgxpool.Pool, courseCode string) (*SyllabusPayload, error) {
	return course.GetSyllabusByCourseCode(ctx, pool, courseCode)
}

func HasSyllabusAcceptance(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (bool, error) {
	return course.HasSyllabusAcceptance(ctx, pool, courseID, userID)
}

func RecordSyllabusAcceptance(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) error {
	return course.RecordSyllabusAcceptance(ctx, pool, courseID, userID)
}

func UpsertSyllabus(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, sections []SyllabusSection, requireSyllabusAcceptance bool) (time.Time, error) {
	return course.UpsertSyllabus(ctx, pool, courseID, sections, requireSyllabusAcceptance)
}
