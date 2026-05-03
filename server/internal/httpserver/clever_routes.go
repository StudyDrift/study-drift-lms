package httpserver

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/service/authservice"
	"github.com/lextures/lextures/server/internal/service/cleverauth"
)

// handleCleverLogin is GET /auth/clever/login — Clever OAuth with PKCE.
func (d Deps) handleCleverLogin() http.HandlerFunc {
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
		if d.Clever == nil {
			d.Clever = cleverauth.NewService(d.effectiveConfig())
		}
		q := r.URL.Query()
		var next *string
		if s := strings.TrimSpace(q.Get("next")); s != "" {
			next = &s
		}
		target, err := d.Clever.BuildAuthorizeRedirectURL(r.Context(), d.Pool, next)
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		http.Redirect(w, r, target, http.StatusTemporaryRedirect)
	}
}

// handleCleverCallback is GET /auth/clever/callback — token exchange + JIT provision + app JWT fragment redirect.
func (d Deps) handleCleverCallback() http.HandlerFunc {
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
		if d.Clever == nil {
			d.Clever = cleverauth.NewService(d.effectiveConfig())
		}
		q := r.URL.Query()
		if errName := q.Get("error"); errName != "" {
			msg := q.Get("error_description")
			if msg == "" {
				msg = errName
			}
			enc := url.QueryEscape(msg)
			public := d.Clever.PublicWebBase()
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in</title></head>
<body><script>location.replace("` + public + `/sso-error?message=` + enc + `");</script>
<p>Redirecting…</p></body></html>`))
			return
		}
		code := q.Get("code")
		state := q.Get("state")
		res, nextPath, err := d.Clever.CompleteLogin(r.Context(), d.Pool, d.JWTSigner, code, state, authservice.ClientMetaFromRequest(r))
		if err != nil {
			writeAuthErr(w, err)
			return
		}
		frag := "access_token=" + url.QueryEscape(res.AccessToken) + "&token_type=" + url.QueryEscape(res.TokenType)
		if res.RefreshToken != "" {
			frag += "&refresh_token=" + url.QueryEscape(res.RefreshToken) + fmt.Sprintf("&expires_in=%d", res.ExpiresIn)
		}
		if res.MFAPendingToken != "" {
			frag += "&mfa_pending_token=" + url.QueryEscape(res.MFAPendingToken)
			if res.RequiresMFA {
				frag += "&requires_mfa=1"
			}
			if res.MFASetupRequired {
				frag += "&mfa_setup_required=1"
			}
		}
		next := "/"
		if nextPath != nil {
			np := strings.TrimSpace(*nextPath)
			if np != "" && np[0] == '/' {
				next = np
			}
		}
		public := d.Clever.PublicWebBase()
		nextQ := ""
		if next != "/" {
			nextQ = "&next=" + url.QueryEscape(next)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		html := `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in</title></head>
<body><script>location.replace("` + public + `/saml-callback#` + frag + nextQ + `");</script>
<p>Redirecting to the app…</p></body></html>`
		_, _ = w.Write([]byte(html))
	}
}
