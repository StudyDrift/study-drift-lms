package enrollmentgroup

import "github.com/google/uuid"

type EnrollmentGroupMembershipPublic struct {
	GroupSetID uuid.UUID `json:"groupSetId"`
	GroupID    uuid.UUID `json:"groupId"`
}

type EnrollmentGroupPublic struct {
	ID            uuid.UUID   `json:"id"`
	Name          string      `json:"name"`
	SortOrder     int32       `json:"sortOrder"`
	EnrollmentIDs []uuid.UUID `json:"enrollmentIds"`
}

type EnrollmentGroupSetPublic struct {
	ID        uuid.UUID              `json:"id"`
	Name      string                 `json:"name"`
	SortOrder int32                  `json:"sortOrder"`
	Groups    []EnrollmentGroupPublic `json:"groups"`
}

type EnrollmentGroupsTreeResponse struct {
	GroupSets []EnrollmentGroupSetPublic `json:"groupSets"`
}

type CreateEnrollmentGroupSetRequest struct {
	Name string `json:"name"`
}

type CreateEnrollmentGroupRequest struct {
	Name string `json:"name"`
}

type PatchEnrollmentGroupSetRequest struct {
	Name string `json:"name"`
}

type PatchEnrollmentGroupRequest struct {
	Name string `json:"name"`
}

type PutEnrollmentGroupMembershipRequest struct {
	EnrollmentID uuid.UUID  `json:"enrollmentId"`
	GroupSetID   uuid.UUID  `json:"groupSetId"`
	GroupID      *uuid.UUID `json:"groupId"`
}
