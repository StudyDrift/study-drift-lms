package gradingscheme

import (
	"encoding/json"

	"github.com/google/uuid"
)

type GradingSchemeResponse struct {
	ID        uuid.UUID       `json:"id"`
	Name      string          `json:"name"`
	Type      string          `json:"type"`
	ScaleJSON json.RawMessage `json:"scaleJson"`
}

type CourseGradingSchemeEnvelope struct {
	Scheme *GradingSchemeResponse `json:"scheme"`
}

type PutGradingSchemeRequest struct {
	Name      *string         `json:"name"`
	Type      string          `json:"type"`
	ScaleJSON json.RawMessage `json:"scaleJson"`
}
