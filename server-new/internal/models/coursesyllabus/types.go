package coursesyllabus

import "time"

type SyllabusSection struct {
	ID       string `json:"id"`
	Heading  string `json:"heading"`
	Markdown string `json:"markdown"`
}

type CourseSyllabusResponse struct {
	Sections                  []SyllabusSection `json:"sections"`
	UpdatedAt                 time.Time         `json:"updatedAt"`
	RequireSyllabusAcceptance bool              `json:"requireSyllabusAcceptance"`
	SyllabusAcceptancePending bool              `json:"syllabusAcceptancePending,omitempty"`
}

type SyllabusAcceptanceStatusResponse struct {
	RequireSyllabusAcceptance bool `json:"requireSyllabusAcceptance"`
	HasAcceptedSyllabus       bool `json:"hasAcceptedSyllabus"`
}

type UpdateCourseSyllabusRequest struct {
	Sections                  []SyllabusSection `json:"sections"`
	RequireSyllabusAcceptance bool              `json:"requireSyllabusAcceptance"`
}

type GenerateSyllabusSectionRequest struct {
	Instructions    string `json:"instructions"`
	SectionHeading  string `json:"sectionHeading"`
	ExistingMarkdown string `json:"existingMarkdown"`
}

type GenerateSyllabusSectionResponse struct {
	Markdown string `json:"markdown"`
}
