package settingssystemprompts

import "time"

type SystemPromptItem struct {
	Key       string    `json:"key"`
	Label     string    `json:"label"`
	Content   string    `json:"content"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type SystemPromptsListResponse struct {
	Prompts []SystemPromptItem `json:"prompts"`
}

type SystemPromptUpdateRequest struct {
	Content string `json:"content"`
}
