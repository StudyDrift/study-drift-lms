package httpserver

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/service/authservice"
	"github.com/lextures/lextures/server-new/internal/service/oidcauth"
)

// handleOIDCLogin is GET /auth/oidc/{provider}/login — starts the OIDC code+PKCE flow.
func (d Deps) handleOIDCLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "Database is not configured.")
			return
		}
		if d.OIDC == nil {
			d.OIDC = oidcauth.NewService(d.effectiveConfig())
		}
		prov := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "provider")))
		q := r.URL.Query()
		var next, linkID, configID *string
		if s := strings.TrimSpace(q.Get("next")); s != "" {
			next = &s
		}
		if s := strings.TrimSpace(q.Get("linkId")); s != "" {
			linkID = &s
		}
		if s := strings.TrimSpace(q.Get("configId")); s != "" {
			configID = &s
		}
		var linkUUID *uuid.UUID
		if linkID != nil && *linkID != "" {
			u, err := uuid.Parse(*linkID)
			if err != nil {
				writeAuthErr(w, authservice.FieldError{Message: "Invalid linkId."})
				return
			}
			linkUUID = &u
		}
		var configUUID *uuid.UUID
		if configID != nil && *configID != "" {
			u, err := uuid.Parse(*configID)
			if err != nil {
				writeAuthErr(w, authservice.FieldError{Message: "Invalid configId."})
				return
			}
			configUUID = &u
		}
		target, err := d.OIDC.BuildAuthorizeRedirectURL(r.Context(), d.Pool, prov, configUUID, linkUUID, next)
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		http.Redirect(w, r, target, http.StatusTemporaryRedirect)
	}
}

// handleOIDCCallback is GET /auth/oidc/{provider}/callback — exchanges code, returns HTML to app with fragment token.
func (d Deps) handleOIDCCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "Database is not configured.")
			return
		}
		if d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "JWT is not configured.")
			return
		}
		if d.OIDC == nil {
			d.OIDC = oidcauth.NewService(d.effectiveConfig())
		}
		prov := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "provider")))
		q := r.URL.Query()
		if errName := q.Get("error"); errName != "" {
			msg := q.Get("error_description")
			if msg == "" {
				msg = errName
			}
			enc := url.QueryEscape(msg)
			public := d.OIDC.PublicWebBase()
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in</title></head>
<body><script>location.replace("` + public + `/sso-error?message=` + enc + `");</script>
<p>Redirecting…</p></body></html>`))
			return
		}
		code := q.Get("code")
		if code == "" {
			writeAuthErr(w, authservice.FieldError{Message: "Missing authorization code."})
			return
		}
		state := q.Get("state")
		if state == "" {
			writeAuthErr(w, authservice.FieldError{Message: "Missing state parameter."})
			return
		}
		res, nextPath, err := d.OIDC.CompleteLogin(r.Context(), d.Pool, d.JWTSigner, prov, code, state)
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		enc := url.QueryEscape(res.AccessToken)
		next := "/"
		if nextPath != nil {
			np := strings.TrimSpace(*nextPath)
			if np != "" && np[0] == '/' {
				next = np
			}
		}
		public := d.OIDC.PublicWebBase()
		nextQ := ""
		if next != "/" {
			nextQ = "&next=" + url.QueryEscape(next)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		html := `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in</title></head>
<body><script>location.replace("` + public + `/saml-callback#access_token=` + enc + `&token_type=Bearer` + nextQ + `");</script>
<p>Redirecting to the app…</p></body></html>`
		_, _ = w.Write([]byte(html))
	}
}
