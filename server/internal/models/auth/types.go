package auth

import "github.com/google/uuid"

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SignupRequest struct {
	Email       string  `json:"email"`
	Password    string  `json:"password"`
	DisplayName *string `json:"displayName"`
}

type UserPublic struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"displayName"`
	FirstName   *string   `json:"firstName"`
	LastName    *string   `json:"lastName"`
	AvatarURL   *string   `json:"avatarUrl"`
	UITheme     string    `json:"uiTheme"`
	SID         *string   `json:"sid"`
}

type AuthResponse struct {
	AccessToken string     `json:"access_token"`
	TokenType   string     `json:"token_type"`
	User        UserPublic `json:"user"`
}

type ForgotPasswordRequest struct {
	Email string `json:"email"`
}

type ForgotPasswordResponse struct {
	Message string `json:"message"`
}

type ResetPasswordRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

type ResetPasswordResponse struct {
	Message string `json:"message"`
}
