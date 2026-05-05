package enrollment

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursesections"
)

// GradebookStudentSectionFilter returns nil when all students should be shown, or a non-empty
// slice of section IDs when the gradebook must be limited to those sections (plan 5.4).
func GradebookStudentSectionFilter(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, courseCode string, viewer uuid.UUID) ([]uuid.UUID, error) {
	pub, err := course.GetPublicByCourseCode(ctx, pool, courseCode)
	if err != nil || pub == nil || !pub.SectionsEnabled {
		return nil, err
	}
	staff, err := UserIsCourseStaff(ctx, pool, courseCode, viewer)
	if err != nil {
		return nil, err
	}
	if !staff {
		return nil, nil
	}
	secIDs, err := coursesections.ListSectionIDsWhereInstructor(ctx, pool, courseID, viewer)
	if err != nil {
		return nil, err
	}
	if len(secIDs) == 0 {
		return nil, nil
	}
	return secIDs, nil
}
