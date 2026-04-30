package enrollment

import (
	"time"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/models/enrollmentgroup"
)

type CourseEnrollmentPublic struct {
	ID                 uuid.UUID                                        `json:"id"`
	UserID             uuid.UUID                                        `json:"userId"`
	DisplayName        *string                                          `json:"displayName"`
	Role               string                                           `json:"role"`
	LastCourseAccessAt *time.Time                                       `json:"lastCourseAccessAt"`
	GroupMemberships   []enrollmentgroup.EnrollmentGroupMembershipPublic `json:"groupMemberships,omitempty"`
}

type CourseEnrollmentsResponse struct {
	Enrollments             []CourseEnrollmentPublic `json:"enrollments"`
	ViewerEnrollmentRoles   []string                 `json:"viewerEnrollmentRoles"`
	EnrollmentGroupsEnabled bool                     `json:"enrollmentGroupsEnabled"`
}

type EnrollSelfAsStudentResponse struct {
	Created bool `json:"created"`
}

type PatchEnrollmentRequest struct {
	AppRoleID *uuid.UUID `json:"appRoleId"`
	Role      *string    `json:"role"`
}

type AddEnrollmentsRequest struct {
	Emails    string     `json:"emails"`
	AppRoleID *uuid.UUID `json:"appRoleId"`
}

type AddEnrollmentsResponse struct {
	Added           []string `json:"added"`
	AlreadyEnrolled []string `json:"alreadyEnrolled"`
	NotFound        []string `json:"notFound"`
}
