package enrollment

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/crosslisting"
	"github.com/lextures/lextures/server/internal/repos/coursesections"
)

// GradebookStudentSectionFilter returns nil when all students should be shown, or a non-empty
// slice of section IDs when the gradebook must be limited to those sections (plan 5.4).
// When mergedCrossList is true and cross-listing applies, an instructor teaching one section
// of a merged group receives all section IDs in that group for the combined roster (plan 5.5).
func GradebookStudentSectionFilter(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, courseCode string, viewer uuid.UUID, mergedCrossList bool) ([]uuid.UUID, error) {
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
	secIDs, err = crosslisting.ExpandInstructorSectionFilter(ctx, pool, courseID, secIDs, mergedCrossList)
	return secIDs, err
}
