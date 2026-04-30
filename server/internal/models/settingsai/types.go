package settingsai

type AiSettingsUpdateRequest struct {
	ImageModelID       string `json:"imageModelId"`
	CourseSetupModelID string `json:"courseSetupModelId"`
}

type AiSettingsResponse struct {
	ImageModelID       string `json:"imageModelId"`
	CourseSetupModelID string `json:"courseSetupModelId"`
}

type AiModelOption struct {
	ID                       string   `json:"id"`
	Name                     string   `json:"name"`
	ContextLength            *uint64  `json:"contextLength"`
	InputPricePerMillionUSD  *float64 `json:"inputPricePerMillionUsd"`
	OutputPricePerMillionUSD *float64 `json:"outputPricePerMillionUsd"`
	ModalitiesSummary        *string  `json:"modalitiesSummary"`
}

type AiModelsListResponse struct {
	Configured bool            `json:"configured"`
	Models     []AiModelOption `json:"models"`
}

type GenerateCourseImageRequest struct {
	Prompt string `json:"prompt"`
}

type GenerateCourseImageResponse struct {
	ImageURL string `json:"imageUrl"`
}
