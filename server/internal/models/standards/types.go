package standards

import (
	"time"

	"github.com/google/uuid"
)

type StandardFrameworkBrief struct {
	ID      uuid.UUID `json:"id"`
	Code    string    `json:"code"`
	Name    string    `json:"name"`
	Version string    `json:"version"`
}

type StandardCodeAPI struct {
	ID                         uuid.UUID              `json:"id"`
	Framework                  StandardFrameworkBrief `json:"framework"`
	ParentID                   *uuid.UUID             `json:"parentId"`
	Code                       string                 `json:"code"`
	ShortCode                  *string                `json:"shortCode"`
	Description                string                 `json:"description"`
	GradeBand                  *string                `json:"gradeBand"`
	DepthLevel                 int16                  `json:"depthLevel"`
	Superseded                 bool                   `json:"superseded"`
	SupersededByStandardCodeID *uuid.UUID             `json:"supersededByStandardCodeId"`
	CreatedAt                  time.Time              `json:"createdAt"`
}

type StandardsImportResponse struct {
	JobID         *uuid.UUID `json:"jobId"`
	FrameworkCode string     `json:"frameworkCode"`
	RecordCount   int        `json:"recordCount"`
}

type StandardCoverageAPI struct {
	StandardCodeID             uuid.UUID  `json:"standardCodeId"`
	Code                       string     `json:"code"`
	ShortCode                  *string    `json:"shortCode"`
	Description                string     `json:"description"`
	GradeBand                  *string    `json:"gradeBand"`
	QuestionCount              int64      `json:"questionCount"`
	AverageMastery             *float64   `json:"averageMastery"`
	CoverageStatus             string     `json:"coverageStatus"`
	Superseded                 bool       `json:"superseded"`
	SupersededByStandardCodeID *uuid.UUID `json:"supersededByStandardCodeId"`
}

type CourseStandardsCoverageResponse struct {
	Standards []StandardCoverageAPI `json:"standards"`
}
