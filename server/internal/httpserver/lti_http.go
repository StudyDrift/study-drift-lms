// LTI 1.3 platform routes (parity with server/src/routes/lti.rs, except Rust-stub 501s kept as 501).
package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/lti"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursegrades"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	ltidb "github.com/lextures/lextures/server/internal/repos/lti"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func (d Deps) requireLtiHandler(w http.ResponseWriter) bool {
	if d.Lti == nil || !d.Lti.Enabled {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "LTI is not enabled on this server.")
		return false
	}
	return true
}

func bearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return "", false
	}
	const p = "Bearer "
	if !strings.HasPrefix(h, p) {
		return "", false
	}
	return strings.TrimSpace(h[len(p):]), true
}

// registerLTIAPIRoutes is called from saml_lti.go; registers non-501 LTI / admin routes when implemented.
// (kept in one place next to registerLTIHTTPRoutes in saml_lti.go for ordering.)

// --- Provider login / launch (form POST) ---

func (d Deps) handleLtiProviderLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.requireLtiHandler(w) {
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if err := r.ParseForm(); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid form body.")
			return
		}
		iss := strings.TrimSpace(r.FormValue("iss"))
		clientID := strings.TrimSpace(r.FormValue("client_id"))
		target := strings.TrimSpace(r.FormValue("target_link_uri"))
		if iss == "" || clientID == "" || target == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing iss, client_id, or target_link_uri.")
			return
		}
		reg, err := ltidb.FindPlatformRegistration(r.Context(), d.Pool, iss, clientID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Database error.")
			return
		}
		if reg == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if len(reg.ToolRedirectURIs) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "No tool redirect URIs configured for this registration.")
			return
		}
		redirectURI := strings.TrimSpace(reg.ToolRedirectURIs[0])
		if redirectURI == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid redirect URIs.")
			return
		}
		state := uuid.NewString()
		nonce := uuid.NewString()
		var lh, dep, msg *string
		if s := strings.TrimSpace(r.FormValue("login_hint")); s != "" {
			lh = &s
		}
		if s := strings.TrimSpace(r.FormValue("lti_deployment_id")); s != "" {
			dep = &s
		}
		if s := strings.TrimSpace(r.FormValue("lti_message_hint")); s != "" {
			msg = &s
		}
		exp := time.Now().UTC().Add(15 * time.Minute)
		if err := ltidb.InsertOIDCState(r.Context(), d.Pool, state, iss, reg.ClientID, nonce, target, lh, dep, msg, exp); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not store OIDC state.")
			return
		}
		v := url.Values{}
		v.Set("scope", "openid")
		v.Set("response_type", "id_token")
		v.Set("response_mode", "form_post")
		v.Set("prompt", "none")
		v.Set("client_id", reg.ClientID)
		v.Set("redirect_uri", redirectURI)
		if lh != nil {
			v.Set("login_hint", *lh)
		} else {
			v.Set("login_hint", "")
		}
		v.Set("state", state)
		v.Set("nonce", nonce)
		dest := strings.TrimRight(reg.PlatformAuthURL, "?")
		sep := "?"
		if strings.Contains(dest, "?") {
			sep = "&"
		}
		http.Redirect(w, r, dest+sep+v.Encode(), http.StatusFound)
	}
}

func (d Deps) handleLtiProviderLaunch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.requireLtiHandler(w) {
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if err := r.ParseForm(); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid form body.")
			return
		}
		idTok := r.FormValue("id_token")
		state := r.FormValue("state")
		if idTok == "" || state == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing id_token or state.")
			return
		}
		issuer, clientID, oidcNonce, _, _, _, _, err := ltidb.TakeOIDCState(r.Context(), d.Pool, state)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Database error.")
			return
		}
		if issuer == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid or expired OIDC state.")
			return
		}
		reg, err := ltidb.FindPlatformRegistration(r.Context(), d.Pool, issuer, clientID)
		if err != nil || reg == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		pub, err := lti.PublicKeyForJWT(reg.PlatformJWKSURL, idTok)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not load platform JWKS.")
			return
		}
		claims, err := lti.VerifyLtiIDToken(idTok, pub, reg.PlatformISS, reg.ClientID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid LTI id token: "+err.Error())
			return
		}
		if claims.Nonce != oidcNonce {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "OIDC nonce mismatch.")
			return
		}
		var expT time.Time
		if claims.ExpiresAt != nil {
			expT = claims.ExpiresAt.UTC()
		} else {
			expT = time.Now().UTC().Add(time.Hour)
		}
		ok, err := ltidb.TryInsertConsumedNonce(r.Context(), d.Pool, claims.Nonce, expT)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Database error.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "nonce_already_used")
			return
		}
		uid, err := resolveOrProvisionPlatformUser(r.Context(), d.Pool, reg.PlatformISS, claims)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		ur, err := user.FindByID(r.Context(), d.Pool, uid)
		if err != nil || ur == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "User lookup failed.")
			return
		}
		email := ur.Email
		if email == "" {
			email = "lti@user"
		}
		if d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		appTok, err := d.JWTSigner.Sign(r.Context(), uid.String(), email, "", "", nil)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not issue session token.")
			return
		}
		public := strings.TrimRight(strings.TrimSpace(d.effectiveConfig().PublicWebOrigin), "/")
		escTok, _ := json.Marshal(appTok)
		escURL, _ := json.Marshal(public + "/")
		html := fmt.Sprintf(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Signing in…</title></head>
<body><p>Signing you in…</p><script>
(() => {
  const t = %s;
  try { localStorage.setItem('studydrift_access_token', t); } catch (e) {}
  window.location.replace(%s);
})();
</script></body></html>`, string(escTok), string(escURL))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(html))
	}
}

func resolveOrProvisionPlatformUser(ctx context.Context, pool *pgxpool.Pool, iss string, claims *lti.LtiIDTokenClaims) (uuid.UUID, error) {
	if ex, err := ltidb.FindUserForPlatformSubject(ctx, pool, iss, claims.Subject); err != nil {
		return uuid.UUID{}, err
	} else if ex != nil {
		return *ex, nil
	}
	email := "lti+" + uuid.NewString() + "@lti-provisioned.invalid"
	if claims.Email != nil && strings.Contains(*claims.Email, "@") {
		email = user.NormalizeEmail(*claims.Email)
	}
	var disp *string
	if claims.Name != nil && strings.TrimSpace(*claims.Name) != "" {
		s := strings.TrimSpace(*claims.Name)
		disp = &s
	}
	h, err := auth.HashPassword(uuid.NewString() + uuid.NewString())
	if err != nil {
		return uuid.UUID{}, err
	}
	row, err := user.InsertUser(ctx, pool, email, h, disp)
	if err != nil {
		var pe *pgconn.PgError
		if (errors.As(err, &pe) && pe.Code == "23505") || strings.Contains(err.Error(), "23505") {
			existing, e2 := user.FindByEmailCI(ctx, pool, email)
			if e2 != nil || existing == nil {
				return uuid.UUID{}, fmt.Errorf("could not resolve LTI user")
			}
			uid, e3 := uuid.Parse(existing.ID)
			if e3 != nil {
				return uuid.UUID{}, e3
			}
			_ = ltidb.UpsertLtiPlatformAccount(ctx, pool, iss, claims.Subject, uid)
			return uid, nil
		}
		return uuid.UUID{}, err
	}
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		return uuid.UUID{}, err
	}
	if err := ltidb.UpsertLtiPlatformAccount(ctx, pool, iss, claims.Subject, uid); err != nil {
		return uuid.UUID{}, err
	}
	return uid, nil
}

func (d Deps) handleLtiNRPSMemberships() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.requireLtiHandler(w) {
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		tok, ok := bearerToken(r)
		if !ok {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		courseCode := strings.TrimSpace(r.URL.Query().Get("course_code"))
		if courseCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "courseCode is required.")
			return
		}
		payload, err := lti.DecodeJWTPayloadJSON(tok)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		iss, _ := payload["iss"].(string)
		aud := payload["aud"]
		if iss == "" {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		audStr := firstAudString(aud)
		if audStr == "" {
			if s, _ := payload["client_id"].(string); s != "" {
				audStr = s
			}
		}
		if audStr == "" {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		reg, err := ltidb.FindPlatformRegistration(r.Context(), d.Pool, iss, audStr)
		if err != nil || reg == nil {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		pub, err := lti.PublicKeyForJWT(reg.PlatformJWKSURL, tok)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		if _, err := lti.VerifyLtiBearerToken(tok, pub, reg.PlatformISS); err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		base := strings.TrimRight(d.Lti.APIBaseURL, "/")
		doc, err := nrpsJSON(r.Context(), d.Pool, base, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(doc)
	}
}

func firstAudString(aud any) string {
	switch v := aud.(type) {
	case string:
		return v
	case []any:
		if len(v) == 0 {
			return ""
		}
		if s, ok := v[0].(string); ok {
			return s
		}
	}
	return ""
}

func nrpsJSON(ctx context.Context, pool *pgxpool.Pool, apiUserBase, courseCode string) (map[string]any, error) {
	cid, err := course.GetIDByCourseCode(ctx, pool, courseCode)
	if err != nil || cid == nil {
		return nil, err
	}
	rows, err := enrollment.ListRosterForCourse(ctx, pool, courseCode)
	if err != nil {
		return nil, err
	}
	members := make([]map[string]any, 0, len(rows))
	for _, e := range rows {
		role := mapNRPSRole(e.Role)
		name := "Learner"
		if e.DisplayName != nil && *e.DisplayName != "" {
			name = *e.DisplayName
		}
		members = append(members, map[string]any{
			"user_id": fmt.Sprintf("%s/users/%s", apiUserBase, e.UserID.String()),
			"roles":   []string{role},
			"status":  "Active",
			"name":    name,
			"email":   nil,
		})
	}
	return map[string]any{
		"id": fmt.Sprintf("%s/nrps/v2p/memberships/%s", apiUserBase, cid.String()),
		"context": map[string]any{
			"id":    fmt.Sprintf("%s/courses/%s", apiUserBase, courseCode),
			"title": courseCode,
		},
		"members": members,
	}, nil
}

func mapNRPSRole(role string) string {
	switch strings.ToLower(role) {
	case "teacher", "instructor":
		return "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"
	case "ta":
		return "http://purl.imsglobal.org/vocab/lis/v2/membership#TeachingAssistant"
	default:
		return "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"
	}
}

type agsBody struct {
	LineItemURL    string  `json:"lineItemUrl"`
	StudentUserID  string  `json:"studentUserId"`
	ScoreGiven     float64 `json:"scoreGiven"`
	ScoreMaximum   float64 `json:"scoreMaximum"`
}

func (d Deps) handleLtiAGSScores() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.requireLtiHandler(w) {
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		tok, ok := bearerToken(r)
		if !ok {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var body agsBody
		if err := json.Unmarshal(b, &body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		payload, err := lti.DecodeJWTPayloadJSON(tok)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		toolISS, _ := payload["iss"].(string)
		aud := firstAudString(payload["aud"])
		if toolISS == "" || aud == "" {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		tools, err := ltidb.ListExternalToolsForScores(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Database error.")
			return
		}
		var tool *ltidb.ExternalTool
		for i := range tools {
			if tools[i].Active && tools[i].ToolIssuer == toolISS && tools[i].ClientID == aud {
				tool = &tools[i]
				break
			}
		}
		if tool == nil {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		pub, err := lti.PublicKeyForJWT(tool.ToolJWKSURL, tok)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		if _, err := lti.VerifyToolBearerTokenForAGS(tok, pub, toolISS, tool.ClientID); err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		link, err := ltidb.FindResourceLinkByLineItemURL(r.Context(), d.Pool, body.LineItemURL)
		if err != nil || link == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		stu, err := uuid.Parse(body.StudentUserID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid student id.")
			return
		}
		if err := coursegrades.UpsertPointsFromLTI(r.Context(), d.Pool, link.CourseID, stu, link.StructureItemID, body.ScoreGiven, body.ScoreMaximum); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleLtiConsumerFrame() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.requireLtiHandler(w) {
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
		if ticket == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid or expired launch ticket.")
			return
		}
		tok, err := d.JWTSigner.VerifyLTIEmbedTicket(ticket)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid or expired launch ticket.")
			return
		}
		if _, e := uuid.Parse(tok.UserID); e != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid ticket.")
			return
		}
		cid, err := uuid.Parse(tok.CourseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid ticket.")
			return
		}
		iid, err := uuid.Parse(tok.ItemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid ticket.")
			return
		}
		cc, err := course.GetCourseCodeByID(r.Context(), d.Pool, cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Database error.")
			return
		}
		if cc == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		_ = cc

		link, err := ltidb.GetResourceLinkForStructureItem(r.Context(), d.Pool, cid, iid)
		if err != nil || link == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		tool, err := ltidb.GetExternalToolByID(r.Context(), d.Pool, link.ExternalToolID)
		if err != nil || tool == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if !tool.Active {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		claims, _ := lti.PlatformRS256TokenHints(d.Lti.APIBaseURL, tool.ToolIssuer, tok.UserID, tok.CourseID, tok.ItemID, "en-US")
		hint, err := d.Lti.Keys.SignRS256HintJWT(claims)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not build launch token.")
			return
		}
		title := tool.Name
		if link.Title != nil && *link.Title != "" {
			title = *link.Title
		}
		titleEsc := html.EscapeString(title)
		actionEsc := html.EscapeString(tool.ToolOidcAuthURL)
		hintEsc := html.EscapeString(hint)
		h := fmt.Sprintf(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>%s</title></head>
<body>
<p><a href="%s" target="_blank" rel="noopener noreferrer">Open %s in a new tab</a> if the embed is blocked.</p>
<iframe title="%s" name="f" style="width:100%%;min-height:640px;border:1px solid #ccc" src="about:blank"></iframe>
<form id="p" method="post" action="%s" target="f">
  <input type="hidden" name="login_hint" value="%s" />
</form>
<script>document.getElementById('p').submit();</script>
</body></html>`, titleEsc, actionEsc, titleEsc, titleEsc, actionEsc, hintEsc)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(h))
	}
}

func lti501JSON(msg string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]any{"message": msg})
	}
}
