package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	webauthnlib "github.com/go-webauthn/webauthn/webauthn"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/authservice"
	"github.com/lextures/lextures/server/internal/service/mfaservice"
)

func (d Deps) mfaPendingUser(r *http.Request) (auth.MFAPendingUser, error) {
	if d.JWTSigner == nil {
		return auth.MFAPendingUser{}, auth.ErrInvalidToken
	}
	tok, ok := bearerToken(r)
	if !ok || tok == "" {
		return auth.MFAPendingUser{}, auth.ErrInvalidToken
	}
	return d.JWTSigner.VerifyMFAPending(r.Context(), tok)
}

func (d Deps) webAuthnInstance(w http.ResponseWriter) (*webauthnlib.WebAuthn, bool) {
	cfg := d.effectiveConfig()
	if !cfg.MFAEnabled {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Two-factor authentication is disabled.")
		return nil, false
	}
	wa, err := mfaservice.WebAuthnFromConfig(cfg)
	if err != nil {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Passkeys are not available on this server.")
		return nil, false
	}
	return wa, true
}

func (d Deps) handleMFATOTPEnrol() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		var uid uuid.UUID
		if u, err := auth.UserFromRequest(r, d.JWTSigner); err == nil {
			uid, err = uuid.Parse(u.UserID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
				return
			}
		} else if pend, err := d.mfaPendingUser(r); err == nil && pend.Purpose == "setup" {
			uid, err = uuid.Parse(pend.UserID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
				return
			}
		} else {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		cfg := d.effectiveConfig()
		credID, uri, err := mfaservice.BeginTOTPEnrol(r.Context(), d.Pool, cfg, uid)
		if err != nil {
			writeMFAErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"credential_id": credID,
			"otpauth_uri":   uri,
		})
	}
}

type mfaTotpVerifyEnrolBody struct {
	CredentialID string `json:"credential_id"`
	Code         string `json:"code"`
}

func (d Deps) handleMFATOTPVerifyEnrol() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		var b mfaTotpVerifyEnrolBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		credUUID, err := uuid.Parse(strings.TrimSpace(b.CredentialID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid credential id.")
			return
		}
		cfg := d.effectiveConfig()

		// Prefer full session; allow MFA pending token so forced-MFA users completing first factor can verify.
		var uid uuid.UUID
		if u, err := auth.UserFromRequest(r, d.JWTSigner); err == nil {
			uid, err = uuid.Parse(u.UserID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
				return
			}
		} else if pend, err := d.mfaPendingUser(r); err == nil && pend.Purpose == "setup" {
			uid, err = uuid.Parse(pend.UserID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
				return
			}
		} else {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}

		codes, err := mfaservice.VerifyTOTPEnrol(r.Context(), d.Pool, cfg, uid, credUUID, b.Code)
		if err != nil {
			writeMFAErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"backup_codes": codes})
	}
}

type mfaTotpChallengeBody struct {
	Code string `json:"code"`
}

func (d Deps) handleMFATOTPChallenge() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		pend, err := d.mfaPendingUser(r)
		if err != nil || pend.Purpose != "challenge" {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "MFA verification required.")
			return
		}
		var b mfaTotpChallengeBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		uid, err := uuid.Parse(pend.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
			return
		}
		cfg := d.effectiveConfig()
		if err := mfaservice.TOTPChallenge(r.Context(), d.Pool, cfg, uid, b.Code); err != nil {
			writeMFAErr(w, err)
			return
		}
		if ok, err := mfaservice.TryConsumeMFAPendingJTI(r.Context(), d.Pool, pend.JTI); err != nil || !ok {
			if err == nil && !ok {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "This sign-in step was already used. Sign in again.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		row, err := user.FindByID(r.Context(), d.Pool, uid)
		if err != nil || row == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		res, err := authservice.AuthResponseForUser(r.Context(), d.Pool, d.JWTSigner, d.effectiveConfig(), row)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

type mfaBackupChallengeBody struct {
	Code string `json:"code"`
}

func (d Deps) handleMFABackupChallenge() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		pend, err := d.mfaPendingUser(r)
		if err != nil || pend.Purpose != "challenge" {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "MFA verification required.")
			return
		}
		var b mfaBackupChallengeBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		uid, err := uuid.Parse(pend.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
			return
		}
		cfg := d.effectiveConfig()
		if err := mfaservice.BackupCodeChallenge(r.Context(), d.Pool, cfg, uid, b.Code); err != nil {
			writeMFAErr(w, err)
			return
		}
		if ok, err := mfaservice.TryConsumeMFAPendingJTI(r.Context(), d.Pool, pend.JTI); err != nil || !ok {
			if err == nil && !ok {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "This sign-in step was already used. Sign in again.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		row, err := user.FindByID(r.Context(), d.Pool, uid)
		if err != nil || row == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		res, err := authservice.AuthResponseForUser(r.Context(), d.Pool, d.JWTSigner, d.effectiveConfig(), row)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

func (d Deps) handleMFAWebAuthnRegisterBegin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		wa, okWA := d.webAuthnInstance(w)
		if !okWA {
			return
		}
		var uid uuid.UUID
		if u, err := auth.UserFromRequest(r, d.JWTSigner); err == nil {
			uid, err = uuid.Parse(u.UserID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
				return
			}
		} else if pend, err := d.mfaPendingUser(r); err == nil && pend.Purpose == "setup" {
			uid, err = uuid.Parse(pend.UserID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
				return
			}
		} else {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		sid, opts, err := mfaservice.BeginWebAuthnRegister(r.Context(), d.Pool, d.effectiveConfig(), wa, uid)
		if err != nil {
			writeMFAErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"session_id": sid, "options": json.RawMessage(opts)})
	}
}

type mfaWebAuthnRegisterCompleteBody struct {
	SessionID   string          `json:"session_id"`
	Credential  json.RawMessage `json:"credential"`
	DisplayName string          `json:"display_name"`
}

func (d Deps) handleMFAWebAuthnRegisterComplete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		wa, okWA := d.webAuthnInstance(w)
		if !okWA {
			return
		}
		var uid uuid.UUID
		if u, err := auth.UserFromRequest(r, d.JWTSigner); err == nil {
			uid, err = uuid.Parse(u.UserID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
				return
			}
		} else if pend, err := d.mfaPendingUser(r); err == nil && pend.Purpose == "setup" {
			uid, err = uuid.Parse(pend.UserID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
				return
			}
		} else {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var body mfaWebAuthnRegisterCompleteBody
		if err := json.Unmarshal(b, &body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		sid := strings.TrimSpace(body.SessionID)
		if sid == "" || len(body.Credential) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "session_id and credential are required.")
			return
		}
		codes, err := mfaservice.FinishWebAuthnRegister(r.Context(), d.Pool, d.effectiveConfig(), wa, uid, sid, body.Credential, body.DisplayName)
		if err != nil {
			writeMFAErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		out := map[string]any{"ok": true}
		if len(codes) > 0 {
			out["backup_codes"] = codes
		}
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (d Deps) handleMFAWebAuthnAuthBegin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		wa, okWA := d.webAuthnInstance(w)
		if !okWA {
			return
		}
		pend, err := d.mfaPendingUser(r)
		if err != nil || pend.Purpose != "challenge" {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "MFA verification required.")
			return
		}
		uid, err := uuid.Parse(pend.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
			return
		}
		sid, opts, err := mfaservice.BeginWebAuthnLogin(r.Context(), d.Pool, d.effectiveConfig(), wa, uid)
		if err != nil {
			writeMFAErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"session_id": sid, "options": json.RawMessage(opts)})
	}
}

type mfaWebAuthnAuthCompleteBody struct {
	SessionID  string          `json:"session_id"`
	Credential json.RawMessage `json:"credential"`
}

func (d Deps) handleMFAWebAuthnAuthComplete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		wa, okWA := d.webAuthnInstance(w)
		if !okWA {
			return
		}
		pend, err := d.mfaPendingUser(r)
		if err != nil || pend.Purpose != "challenge" {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "MFA verification required.")
			return
		}
		uid, err := uuid.Parse(pend.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var body mfaWebAuthnAuthCompleteBody
		if err := json.Unmarshal(b, &body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		sid := strings.TrimSpace(body.SessionID)
		if sid == "" || len(body.Credential) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "session_id and credential are required.")
			return
		}
		cfg := d.effectiveConfig()
		if err := mfaservice.FinishWebAuthnLogin(r.Context(), d.Pool, cfg, wa, uid, sid, body.Credential); err != nil {
			writeMFAErr(w, err)
			return
		}
		if ok, err := mfaservice.TryConsumeMFAPendingJTI(r.Context(), d.Pool, pend.JTI); err != nil || !ok {
			if err == nil && !ok {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "This sign-in step was already used. Sign in again.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		row, err := user.FindByID(r.Context(), d.Pool, uid)
		if err != nil || row == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		res, err := authservice.AuthResponseForUser(r.Context(), d.Pool, d.JWTSigner, d.effectiveConfig(), row)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

// handleMFASetupComplete exchanges an MFA setup pending token for a full session after the user enrolled MFA.
func (d Deps) handleMFASetupComplete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
			return
		}
		pend, err := d.mfaPendingUser(r)
		if err != nil || pend.Purpose != "setup" {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "MFA setup session required.")
			return
		}
		uid, err := uuid.Parse(pend.UserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Invalid MFA session.")
			return
		}
		ok, err := mfaservice.UserHasVerifiedMFA(r.Context(), d.Pool, uid)
		if err != nil || !ok {
			if err == nil && !ok {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeMFAEnrolRequired, "Add an authenticator or passkey before continuing.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		if ok2, err := mfaservice.TryConsumeMFAPendingJTI(r.Context(), d.Pool, pend.JTI); err != nil || !ok2 {
			if err == nil && !ok2 {
				apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "This sign-in step was already used. Sign in again.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		row, err := user.FindByID(r.Context(), d.Pool, uid)
		if err != nil || row == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		res, err := authservice.AuthResponseForUser(r.Context(), d.Pool, d.JWTSigner, d.effectiveConfig(), row)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(res)
	}
}

func (d Deps) handleListMyMFA() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
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
		factors, err := mfaservice.ListFactors(r.Context(), d.Pool, uid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"factors": factors})
	}
}

func (d Deps) handleDeleteMyMFA() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfigured.")
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
		idStr := chi.URLParam(r, "id")
		fid, err := uuid.Parse(strings.TrimSpace(idStr))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		if err := mfaservice.DeleteFactor(r.Context(), d.Pool, uid, fid); err != nil {
			if errors.Is(err, mfaservice.ErrFactorNotFound) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Factor not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Something went wrong.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func writeMFAErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mfaservice.ErrMFADisabled):
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Two-factor authentication is disabled.")
	case errors.Is(err, mfaservice.ErrMFAInvalid):
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeInvalidCredentials, "Invalid code.")
	case errors.Is(err, mfaservice.ErrMFAReplay):
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeInvalidCredentials, "That code was already used.")
	case errors.Is(err, mfaservice.ErrMFAWebAuthnNotReady):
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Passkeys are not available on this server.")
	default:
		if strings.Contains(err.Error(), "too many attempts") {
			apierr.WriteJSON(w, http.StatusTooManyRequests, apierr.CodeInvalidInput, err.Error())
			return
		}
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
	}
}
