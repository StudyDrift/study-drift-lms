package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/auth"
	pp "github.com/lextures/lextures/server/internal/auth/passwordpolicy"
	"github.com/lextures/lextures/server/internal/repos/oidc"
	"github.com/lextures/lextures/server/internal/repos/passwordpolicy"
	"github.com/lextures/lextures/server/internal/repos/samlidp"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

type loginBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type signupBody struct {
	Email       string  `json:"email"`
	Password    string  `json:"password"`
	DisplayName *string `json:"display_name"`
}

type forgotBody struct {
	Email string `json:"email"`
}

type resetBody struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (d Deps) handleLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		var b loginBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		res, err := authservice.Login(r.Context(), d.Pool, d.JWTSigner, d.effectiveConfig(), authservice.LoginRequest{
			Email:    b.Email,
			Password: b.Password,
			Client:   authservice.ClientMetaFromRequest(r),
		})
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

func (d Deps) handleSignup() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		var b signupBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		res, err := authservice.Signup(r.Context(), d.Pool, d.JWTSigner, d.passwordChecker(), authservice.SignupRequest{
			Email:       b.Email,
			Password:    b.Password,
			DisplayName: b.DisplayName,
			Client:      authservice.ClientMetaFromRequest(r),
		})
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

func (d Deps) handleForgotPassword() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		var b forgotBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		res, err := authservice.RequestPasswordReset(r.Context(), d.Pool, d.effectiveConfig(), b.Email)
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

type magicLinkRequestBody struct {
	Email       string  `json:"email"`
	RedirectTo  *string `json:"redirect_to"`
}

func (d Deps) handleMagicLinkRequest() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		var b magicLinkRequestBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		res, err := authservice.RequestMagicLink(r.Context(), d.Pool, d.effectiveConfig(), authservice.MagicLinkRequestRequest{
			Email:      b.Email,
			RedirectTo: b.RedirectTo,
		})
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

type magicLinkConsumeBody struct {
	Token string `json:"token"`
}

func (d Deps) handleMagicLinkConsume() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			w.Header().Set("Allow", fmt.Sprintf("%s, %s", http.MethodGet, http.MethodPost))
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		var tok string
		if r.Method == http.MethodGet {
			tok = strings.TrimSpace(r.URL.Query().Get("token"))
		} else {
			var b magicLinkConsumeBody
			if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			tok = strings.TrimSpace(b.Token)
		}
		res, err := authservice.ConsumeMagicLink(r.Context(), d.Pool, d.JWTSigner, d.effectiveConfig(), tok, authservice.ClientMetaFromRequest(r))
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

type refreshTokenBody struct {
	RefreshToken string `json:"refresh_token"`
}

func (d Deps) handleAuthRefresh() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		var b refreshTokenBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		res, err := authservice.Refresh(r.Context(), d.Pool, d.JWTSigner, b.RefreshToken, authservice.ClientMetaFromRequest(r))
		if err != nil {
			if errors.Is(err, authservice.ErrRefreshInvalid) {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid or expired session.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

func (d Deps) handleAuthLogout() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		var b refreshTokenBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if err := authservice.Logout(r.Context(), d.Pool, b.RefreshToken); err != nil {
			if errors.Is(err, authservice.ErrRefreshInvalid) {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid or expired session.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

func (d Deps) handleAuthLogoutAll() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		u, err := auth.UserFromRequest(r, d.JWTSigner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		uid, err := uuid.Parse(u.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		if err := authservice.LogoutAll(r.Context(), d.Pool, uid); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

func (d Deps) handleResetPassword() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		var b resetBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		res, err := authservice.ResetPassword(r.Context(), d.Pool, d.passwordChecker(), authservice.ResetPasswordRequest{
			Token:    b.Token,
			Password: b.Password,
		})
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

// handleSAMLStatus reports whether SAML SP is enabled and the default IdP for the login UI (server/src/routes/auth.rs saml_status_handler).
func (d Deps) handleSAMLStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if !d.effectiveConfig().SAMLSSOEnabled {
			_, _ = w.Write([]byte(`{"enabled":false}`))
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		idp, err := samlidp.GetDefaultIdP(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInvalidInput, "Failed to read SAML IdP configuration.")
			return
		}
		type idpInfo struct {
			ID        uuid.UUID `json:"id"`
			Label     string    `json:"label"`
			ForceSAML bool      `json:"forceSaml"`
		}
		if idp != nil {
			_ = json.NewEncoder(w).Encode(struct {
				Enabled bool    `json:"enabled"`
				Idp     idpInfo `json:"idp"`
			}{
				Enabled: true,
				Idp: idpInfo{
					ID:        idp.ID,
					Label:     idp.DisplayName,
					ForceSAML: idp.ForceSAML,
				},
			})
			return
		}
		_, _ = w.Write([]byte(`{"enabled":true,"idp":null}`))
	}
}

func (d Deps) handleOIDCStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		cfg := d.effectiveConfig()
		oidcOn := cfg.OIDCSSOEnabled
		cleverOn := cfg.CleverSSOEnabled && cfg.CleverConfigured()
		classOn := cfg.ClassLinkSSOEnabled && cfg.ClassLinkOIDCConfigured()
		if !oidcOn && !cleverOn && !classOn {
			_, _ = w.Write([]byte(`{"enabled":false,"cleverEnabled":false,"classlinkEnabled":false,"providers":[],"custom":[]}`))
			return
		}
		if d.Pool == nil && cfg.OIDCSSOEnabled {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		var customRows []oidc.CustomProviderRow
		var err error
		if d.Pool != nil && cfg.OIDCSSOEnabled {
			customRows, err = oidc.ListCustomConfigs(r.Context(), d.Pool)
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInvalidInput, "Failed to list OIDC providers.")
			return
		}
		type customInfo struct {
			ID          uuid.UUID `json:"id"`
			DisplayName string    `json:"displayName"`
		}
		custom := make([]customInfo, 0, len(customRows))
		for _, c := range customRows {
			custom = append(custom, customInfo{ID: c.ID, DisplayName: c.DisplayName})
		}
		base := strings.TrimRight(cfg.OIDCPublicBaseURL, "/")
		_ = json.NewEncoder(w).Encode(struct {
			Enabled          bool         `json:"enabled"`
			CleverEnabled    bool         `json:"cleverEnabled"`
			ClassLinkEnabled bool         `json:"classlinkEnabled"`
			Clever           bool         `json:"clever"`
			ClassLink        bool         `json:"classlink"`
			APIBase          string       `json:"apiBase"`
			Google           bool         `json:"google"`
			Microsoft        bool         `json:"microsoft"`
			Apple            bool         `json:"apple"`
			Custom           []customInfo `json:"custom"`
		}{
			Enabled:          oidcOn || cleverOn || classOn,
			CleverEnabled:    cleverOn,
			ClassLinkEnabled: classOn,
			Clever:           cleverOn,
			ClassLink:        classOn,
			APIBase:          base,
			Google:           oidcOn && cfg.OIDCGoogleConfigured(),
			Microsoft:        oidcOn && cfg.OIDCMicrosoftConfigured(),
			Apple:            oidcOn && cfg.OIDCAppleConfigured(),
			Custom:           custom,
		})
	}
}

type oidcLinkBody struct {
	Provider string  `json:"provider"`
	ConfigID *string `json:"configId"`
}

func (d Deps) handleOIDCLink() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		u, err := auth.UserFromRequest(r, d.JWTSigner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		uid, err := uuid.Parse(u.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		var b oidcLinkBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		cfg := d.effectiveConfig()
		p := strings.TrimSpace(strings.ToLower(b.Provider))
		if !cfg.OIDCSSOEnabled &&
			(!cfg.CleverSSOEnabled || !cfg.CleverConfigured()) &&
			(!cfg.ClassLinkSSOEnabled || !cfg.ClassLinkOIDCConfigured()) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "OpenID Connect is not enabled on this server.")
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		if p != "google" && p != "microsoft" && p != "apple" && p != "custom" && p != "clever" && p != "classlink" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Unknown OIDC provider.")
			return
		}
		if p == "google" || p == "microsoft" || p == "apple" || p == "custom" {
			if !cfg.OIDCSSOEnabled {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "OpenID Connect is not enabled on this server.")
				return
			}
		}
		if p == "clever" && (!cfg.CleverSSOEnabled || !cfg.CleverConfigured()) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Clever sign-in is not configured on this server.")
			return
		}
		if p == "classlink" && (!cfg.ClassLinkSSOEnabled || !cfg.ClassLinkOIDCConfigured()) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "ClassLink sign-in is not configured on this server.")
			return
		}
		var customID *uuid.UUID
		if p == "custom" {
			if b.ConfigID == nil || strings.TrimSpace(*b.ConfigID) == "" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "configId is required for custom OIDC.")
				return
			}
			cid, err := uuid.Parse(strings.TrimSpace(*b.ConfigID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "configId is required for custom OIDC.")
				return
			}
			customID = &cid
		} else if b.ConfigID != nil && strings.TrimSpace(*b.ConfigID) != "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "configId is only for custom OIDC.")
			return
		}
		linkID, err := oidc.InsertLinkIntent(r.Context(), d.Pool, uid, p, customID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInvalidInput, "Failed to start OIDC link flow.")
			return
		}
		public := strings.TrimRight(cfg.OIDCPublicBaseURL, "/")
		var path string
		if p == "custom" {
			cid := *customID
			path = "/auth/oidc/custom/login?configId=" + cid.String() + "&linkId=" + linkID.String()
		} else {
			path = "/auth/oidc/" + p + "/login?linkId=" + linkID.String()
		}
		loginURL := public + path
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(struct {
			OK       bool   `json:"ok"`
			LinkID   string `json:"linkId"`
			LoginURL string `json:"loginUrl"`
		}{OK: true, LinkID: linkID.String(), LoginURL: loginURL})
	}
}

func writeAuthErr(w http.ResponseWriter, err error) {
	if p, ok := authservice.IsPasswordPolicyViolation(err); ok {
		apierr.WritePasswordPolicyViolation(w, p.Detail, p.Violations)
		return
	}
	st, code, msg := authservice.HTTPErrorFor(err)
	apierr.WriteJSON(w, st, code, msg)
}

func (d Deps) handleGetPublicPasswordPolicy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		row, err := passwordpolicy.LoadEffective(r.Context(), d.Pool, nil)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load password policy.")
			return
		}
		pol := pp.FromDBRow(row)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(struct {
			MinLength      int  `json:"minLength"`
			RequireUpper   bool `json:"requireUpper"`
			RequireLower   bool `json:"requireLower"`
			RequireDigit   bool `json:"requireDigit"`
			RequireSpecial bool `json:"requireSpecial"`
			CheckHIBP      bool `json:"checkHibp"`
		}{
			MinLength:      pol.MinLength,
			RequireUpper:   pol.RequireUpper,
			RequireLower:   pol.RequireLower,
			RequireDigit:   pol.RequireDigit,
			RequireSpecial: pol.RequireSpecial,
			CheckHIBP:      pol.CheckHIBP,
		})
	}
}

type changePasswordBody struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (d Deps) handleChangePassword() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		u, err := auth.UserFromRequest(r, d.JWTSigner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		uid, err := uuid.Parse(u.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		var b changePasswordBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		res, err := authservice.ChangePassword(r.Context(), d.Pool, d.passwordChecker(), uid, authservice.ChangePasswordRequest{
			CurrentPassword: b.CurrentPassword,
			NewPassword:     b.NewPassword,
		})
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}
