package coursestructure

import (
	"time"

	"github.com/google/uuid"
)

type CourseStructureItemRow struct {
	ID                uuid.UUID  `json:"id"`
	CourseID          uuid.UUID  `json:"courseId"`
	SortOrder         int32      `json:"sortOrder"`
	Kind              string     `json:"kind"`
	Title             string     `json:"title"`
	ParentID          *uuid.UUID `json:"parentId"`
	Published         bool       `json:"published"`
	VisibleFrom       *time.Time `json:"visibleFrom"`
	Archived          bool       `json:"archived"`
	DueAt             *time.Time `json:"dueAt"`
	AssignmentGroupID *uuid.UUID `json:"assignmentGroupId"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type CourseStructureItemResponse struct {
	ID                uuid.UUID  `json:"id"`
	SortOrder         int32      `json:"sortOrder"`
	Kind              string     `json:"kind"`
	Title             string     `json:"title"`
	ParentID          *uuid.UUID `json:"parentId"`
	Published         bool       `json:"published"`
	VisibleFrom       *time.Time `json:"visibleFrom"`
	Archived          bool       `json:"archived"`
	DueAt             *time.Time `json:"dueAt"`
	AssignmentGroupID *uuid.UUID `json:"assignmentGroupId"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	IsAdaptive        *bool      `json:"isAdaptive,omitempty"`
	PointsPossible    *int32     `json:"pointsPossible,omitempty"`
	PointsWorth       *int32     `json:"pointsWorth,omitempty"`
	ExternalURL       *string    `json:"externalUrl,omitempty"`
}

func ItemResponseFromRow(row CourseStructureItemRow) CourseStructureItemResponse {
	return CourseStructureItemResponse{
		ID:                row.ID,
		SortOrder:         row.SortOrder,
		Kind:              row.Kind,
		Title:             row.Title,
		ParentID:          row.ParentID,
		Published:         row.Published,
		VisibleFrom:       row.VisibleFrom,
		Archived:          row.Archived,
		DueAt:             row.DueAt,
		AssignmentGroupID: row.AssignmentGroupID,
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
	}
}

type CourseStructureResponse struct {
	Items []CourseStructureItemResponse `json:"items"`
}

type CreateCourseModuleRequest struct {
	Title string `json:"title"`
}

type PatchCourseModuleRequest struct {
	Title       string     `json:"title"`
	Published   bool       `json:"published"`
	VisibleFrom *time.Time `json:"visibleFrom"`
}

type PatchStructureItemRequest struct {
	Title     *string `json:"title"`
	Published *bool   `json:"published"`
	Archived  *bool   `json:"archived"`
}

type PatchStructureItemDueAtRequest struct {
	DueAt time.Time `json:"dueAt"`
}

type CreateCourseHeadingRequest struct {
	Title string `json:"title"`
}

type CreateCourseAssignmentRequest struct {
	Title string `json:"title"`
}

type CreateCourseExternalLinkRequest struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type CreateCourseLTILinkRequest struct {
	Title          string     `json:"title"`
	ExternalToolID uuid.UUID  `json:"externalToolId"`
	ResourceLinkID string     `json:"resourceLinkId"`
	LineItemURL    *string    `json:"lineItemUrl"`
}

type PatchModuleExternalLinkRequest struct {
	URL string `json:"url"`
}

type PatchModuleLTILinkRequest struct {
	Title          *string `json:"title"`
	ResourceLinkID *string `json:"resourceLinkId"`
	LineItemURL    *string `json:"lineItemUrl"`
}

type ModuleExternalLinkResponse struct {
	ItemID    uuid.UUID `json:"itemId"`
	Title     string    `json:"title"`
	URL       string    `json:"url"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ModuleLTILinkResponse struct {
	ItemID           uuid.UUID `json:"itemId"`
	Title            string    `json:"title"`
	ExternalToolID   uuid.UUID `json:"externalToolId"`
	ExternalToolName string    `json:"externalToolName"`
	ResourceLinkID   string    `json:"resourceLinkId"`
	LineItemURL      *string   `json:"lineItemUrl"`
}

type ModuleLTIEmbedTicketResponse struct {
	Ticket string `json:"ticket"`
}

type ReorderCourseStructureRequest struct {
	ModuleOrder        []uuid.UUID              `json:"moduleOrder"`
	ChildOrderByModule map[uuid.UUID][]uuid.UUID `json:"childOrderByModule"`
}
