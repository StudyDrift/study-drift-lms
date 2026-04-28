package conceptgraph

import (
	"time"

	"github.com/google/uuid"

	"github.com/lextures/lextures/server-new/internal/repos/concepts"
)

// JSON mirrors `server/src/repos/concepts::ConceptJson` (API-facing subset of ConceptRow).
type JSON struct {
	ID              uuid.UUID  `json:"id"`
	Slug            string     `json:"slug"`
	Name            string     `json:"name"`
	Description     *string    `json:"description,omitempty"`
	BloomLevel      *string    `json:"bloomLevel,omitempty"`
	ParentConceptID *uuid.UUID `json:"parentConceptId,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

// RowToJSON maps a DB row to the JSON DTO.
func RowToJSON(row concepts.ConceptRow) JSON {
	return JSON{
		ID:              row.ID,
		Slug:            row.Slug,
		Name:            row.Name,
		Description:     row.Description,
		BloomLevel:      row.BloomLevel,
		ParentConceptID: row.ParentConceptID,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}
