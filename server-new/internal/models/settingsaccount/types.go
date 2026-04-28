package settingsaccount

type AccountProfileResponse struct {
	Email       string  `json:"email"`
	DisplayName *string `json:"displayName"`
	FirstName   *string `json:"firstName"`
	LastName    *string `json:"lastName"`
	AvatarURL   *string `json:"avatarUrl"`
	UITheme     string  `json:"uiTheme"`
	SID         *string `json:"sid"`
}

type UpdateAccountProfileRequest struct {
	FirstName *string `json:"firstName"`
	LastName  *string `json:"lastName"`
	AvatarURL *string `json:"avatarUrl"`
	UITheme   *string `json:"uiTheme"`
}

type GenerateAvatarRequest struct {
	Prompt string `json:"prompt"`
}

type GenerateAvatarResponse struct {
	ImageURL string `json:"imageUrl"`
}

type PatchUserStudentIDRequest struct {
	SID *string `json:"sid"`
}
