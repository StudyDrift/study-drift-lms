package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/user"
)

type accountProfileResponse struct {
	Email       string  `json:"email"`
	DisplayName *string `json:"displayName"`
	FirstName   *string `json:"firstName"`
	LastName    *string `json:"lastName"`
	AvatarURL   *string `json:"avatarUrl"`
	UITheme     string  `json:"uiTheme"`
	Sid         *string `json:"sid"`
}

type patchAccountBody struct {
	FirstName *string `json:"firstName"`
	LastName  *string `json:"lastName"`
	AvatarURL *string `json:"avatarUrl"`
	UITheme   *string `json:"uiTheme"`
}

func normalizeName(s *string, label string) (*string, error) {
	if s == nil {
		return nil, nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil, nil
	}
	if len(t) > 80 {
		return nil, apierrError(label + " is too long.")
	}
	return &t, nil
}

func normalizeAvatarURL(s *string) (*string, error) {
	if s == nil {
		return nil, nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil, nil
	}
	if len(t) > 2_000_000 {
		return nil, apierrError("Avatar image URL is too long.")
	}
	isHTTP := strings.HasPrefix(t, "http://") || strings.HasPrefix(t, "https://")
	isData := strings.HasPrefix(t, "data:image/")
	if !isHTTP && !isData {
		return nil, apierrError("Avatar must be an http(s) URL or a data:image upload.")
	}
	return &t, nil
}

func normalizeTheme(s *string) (*string, error) {
	if s == nil {
		return nil, nil
	}
	t := strings.ToLower(strings.TrimSpace(*s))
	if t != "light" && t != "dark" {
		return nil, apierrError("Theme must be \"light\" or \"dark\".")
	}
	return &t, nil
}

type apierrValidationError struct{ msg string }

func (e apierrValidationError) Error() string { return e.msg }

func apierrError(msg string) error { return apierrValidationError{msg: msg} }

func (d Deps) handleGetSettingsAccount() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		row, err := user.FindByID(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load account.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "User not found.")
			return
		}
		writeJSON(w, http.StatusOK, accountProfileResponse{
			Email:       row.Email,
			DisplayName: row.DisplayName,
			FirstName:   row.FirstName,
			LastName:    row.LastName,
			AvatarURL:   row.AvatarURL,
			UITheme:     row.UITheme,
			Sid:         row.Sid,
		})
	}
}

func (d Deps) handlePatchSettingsAccount() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		var req patchAccountBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		firstName, err := normalizeName(req.FirstName, "First name")
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		lastName, err := normalizeName(req.LastName, "Last name")
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		avatarURL, err := normalizeAvatarURL(req.AvatarURL)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		uiTheme, err := normalizeTheme(req.UITheme)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		row, err := user.UpdateProfile(r.Context(), d.Pool, userID, firstName, lastName, avatarURL, uiTheme)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update account.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "User not found.")
			return
		}
		writeJSON(w, http.StatusOK, accountProfileResponse{
			Email:       row.Email,
			DisplayName: row.DisplayName,
			FirstName:   row.FirstName,
			LastName:    row.LastName,
			AvatarURL:   row.AvatarURL,
			UITheme:     row.UITheme,
			Sid:         row.Sid,
		})
	}
}
