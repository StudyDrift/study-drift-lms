package browsersaml

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"
	samllib "github.com/crewjam/saml"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/samlidp"
	"github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

// HTTPStatusError is returned for JSON/plain client errors.
type HTTPStatusError struct {
	Code int
	Msg  string
}

func (e *HTTPStatusError) Error() string { return e.Msg }

// HandleMetadata serves SP metadata XML.
func HandleMetadata(cfg config.Config, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	b, ct, err := SPMetadataXML(cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

// HandleLoginRedirect starts SP-initiated SSO (GET /auth/saml/login?idpId=...&RelayState=...).
func HandleLoginRedirect(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodGet {
		return &HTTPStatusError{http.StatusMethodNotAllowed, http.StatusText(http.StatusMethodNotAllowed)}
	}
	idpStr := strings.TrimSpace(r.URL.Query().Get("idpId"))
	if idpStr == "" {
		return &HTTPStatusError{http.StatusBadRequest, "Missing idpId query parameter."}
	}
	idpUUID, err := uuid.Parse(idpStr)
	if err != nil {
		return &HTTPStatusError{http.StatusBadRequest, "Invalid idpId."}
	}
	row, err := samlidp.GetIDPByID(ctx, pool, idpUUID)
	if err != nil {
		return err
	}
	if row == nil {
		return &HTTPStatusError{http.StatusNotFound, "IdP not found."}
	}
	xmlStr, err := IDPMetadataXMLFromRow(row.EntityID, row.SSOURL, row.IDPCertPem)
	if err != nil {
		return err
	}
	meta, err := ParseIDPMetadata(xmlStr)
	if err != nil {
		return fmt.Errorf("idp metadata: %w", err)
	}
	sp, err := ServiceProvider(cfg, meta)
	if err != nil {
		return err
	}
	sp.AllowIDPInitiated = false
	relay := strings.TrimSpace(r.URL.Query().Get("RelayState"))
	var relayPtr *string
	if relay != "" {
		relayPtr = &relay
	}
	_, _ = samlidp.DeleteStaleAuthnState(ctx, pool)
	_, _ = samlidp.DeleteStaleReplayGuard(ctx, pool)

	req, err := sp.MakeAuthenticationRequest(sp.GetSSOBindingLocation(samllib.HTTPRedirectBinding), samllib.HTTPRedirectBinding, samllib.HTTPPostBinding)
	if err != nil {
		return err
	}
	req.ID = fmt.Sprintf("id-%s", uuid.NewString())
	if err := samlidp.SaveAuthnState(ctx, pool, req.ID, idpUUID, relayPtr); err != nil {
		return err
	}
	u, err := req.Redirect(relay, sp)
	if err != nil {
		return err
	}
	http.Redirect(w, r, u.String(), http.StatusFound)
	return nil
}

// HandleACS completes SAML HTTP-POST binding and issues a JWT.
func HandleACS(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, signer *auth.JWTSigner, publicWebOrigin string, w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		return &HTTPStatusError{http.StatusMethodNotAllowed, http.StatusText(http.StatusMethodNotAllowed)}
	}
	if err := r.ParseForm(); err != nil {
		return &HTTPStatusError{http.StatusBadRequest, "Invalid form body."}
	}
	samlB64 := r.PostFormValue("SAMLResponse")
	if strings.TrimSpace(samlB64) == "" {
		return &HTTPStatusError{http.StatusBadRequest, "Missing SAMLResponse."}
	}
	raw, err := base64.StdEncoding.DecodeString(samlB64)
	if err != nil {
		return &HTTPStatusError{http.StatusBadRequest, "Invalid base64 in SAMLResponse."}
	}
	xmls := strings.TrimSpace(string(raw))
	if xmls == "" {
		return &HTTPStatusError{http.StatusBadRequest, "Empty SAML response body."}
	}
	irt, respID := ScanSAMLResponseShallow(xmls)
	_, _ = samlidp.DeleteStaleAuthnState(ctx, pool)
	_, _ = samlidp.DeleteStaleReplayGuard(ctx, pool)

	var idpID uuid.UUID
	var allowIDPInitiated bool
	var possible []string
	if irt != nil && *irt != "" {
		iid, _, ok, err := samlidp.TakeAuthnState(ctx, pool, *irt)
		if err != nil {
			return err
		}
		if !ok {
			return &HTTPStatusError{http.StatusBadRequest, "SAML: unknown or expired InResponseTo (re-run login from the app)."}
		}
		idpID = iid
		allowIDPInitiated = false
		possible = []string{*irt}
	} else {
		def, err := samlidp.GetDefaultIdP(ctx, pool)
		if err != nil {
			return err
		}
		if def == nil {
			return &HTTPStatusError{http.StatusBadRequest, "SAML: no IdP is configured; cannot complete sign-in."}
		}
		idpID = def.ID
		allowIDPInitiated = true
		possible = nil
	}

	idpRow, err := samlidp.GetIDPByID(ctx, pool, idpID)
	if err != nil {
		return err
	}
	if idpRow == nil {
		return &HTTPStatusError{http.StatusNotFound, "IdP not found."}
	}
	xmlStr, err := IDPMetadataXMLFromRow(idpRow.EntityID, idpRow.SSOURL, idpRow.IDPCertPem)
	if err != nil {
		return err
	}
	meta, err := ParseIDPMetadata(xmlStr)
	if err != nil {
		return err
	}
	sp, err := ServiceProvider(cfg, meta)
	if err != nil {
		return err
	}
	sp.AllowIDPInitiated = allowIDPInitiated

	assertion, err := sp.ParseResponse(r, possible)
	if err != nil {
		return &HTTPStatusError{http.StatusBadRequest, fmt.Sprintf("SAML: invalid assertion (%v)", err)}
	}

	email, first, last, err := MapAssertion(assertion, idpRow)
	if err != nil {
		return err
	}
	if email == "" || !strings.Contains(email, "@") {
		return &HTTPStatusError{http.StatusBadRequest, "SAML: could not obtain an email address for this user."}
	}

	replayKey := "resp:unknown"
	if irt != nil && *irt != "" {
		replayKey = *irt
	} else if respID != nil && *respID != "" {
		replayKey = "resp:" + *respID
	}
	okReplay, err := samlidp.RecordReplay(ctx, pool, replayKey)
	if err != nil {
		return err
	}
	if !okReplay {
		return &HTTPStatusError{http.StatusConflict, "Assertion replay detected."}
	}

	urow, err := user.FindByEmailCI(ctx, pool, email)
	if err != nil {
		return err
	}
	created := false
	var uid uuid.UUID
	if urow == nil {
		created = true
		ph, err := authservice.PlaceholderPasswordHash()
		if err != nil {
			return err
		}
		disp := displayFromNames(first, last)
		urow, err = user.InsertUser(ctx, pool, email, ph, disp)
		if err != nil {
			return err
		}
		uid, err = uuid.Parse(urow.ID)
		if err != nil {
			return err
		}
	} else {
		uid, err = uuid.Parse(urow.ID)
		if err != nil {
			return err
		}
		if first != nil || last != nil {
			_, _ = user.UpdateProfile(ctx, pool, uid, first, last, nil, nil)
		}
	}

	if created {
		role := "Student"
		if guessTeacherFromAssertion(assertion, idpRow) {
			role = "Teacher"
		}
		_ = rbac.AssignUserRoleByName(ctx, pool, uid, role)
	}

	res, err := authservice.AuthResponseForUser(ctx, pool, signer, cfg, urow, authservice.ClientMetaFromRequest(r))
	if err != nil {
		return err
	}

	pub := strings.TrimRight(publicWebOrigin, "/")
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
	next := ""
	if rs := strings.TrimSpace(r.PostFormValue("RelayState")); rs != "" && strings.HasPrefix(rs, "/") {
		next = "&next=" + url.QueryEscape(rs)
	}
	htmlBody := fmt.Sprintf(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in</title></head>
<body>
<script>location.replace("%s/saml-callback#%s%s");</script>
<p>Redirecting to the app…</p>
</body></html>`,
		html.EscapeString(pub), frag, next)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(htmlBody))
	return nil
}

func displayFromNames(first, last *string) *string {
	if first == nil && last == nil {
		return nil
	}
	if first != nil && last != nil {
		f, l := strings.TrimSpace(*first), strings.TrimSpace(*last)
		if f == "" && l == "" {
			return nil
		}
		if f == "" {
			s := l
			return &s
		}
		if l == "" {
			s := f
			return &s
		}
		s := f + " " + l
		return &s
	}
	if first != nil {
		s := strings.TrimSpace(*first)
		if s == "" {
			return nil
		}
		return &s
	}
	s := strings.TrimSpace(*last)
	if s == "" {
		return nil
	}
	return &s
}

func guessTeacherFromAssertion(a *samllib.Assertion, idp *samlidp.IDPRow) bool {
	var mapping map[string]any
	_ = json.Unmarshal(idp.AttributeMapping, &mapping)
	var want string
	if v, ok := mapping["role"]; ok {
		if s, ok := v.(string); ok {
			want = strings.TrimSpace(s)
		}
	}
	for _, stmt := range a.AttributeStatements {
		for _, att := range stmt.Attributes {
			roleish := strings.Contains(strings.ToLower(att.Name), "role")
			if att.FriendlyName != "" {
				roleish = roleish || strings.EqualFold(att.FriendlyName, "role")
			}
			if want == "" && !roleish {
				continue
			}
			if want != "" && !strings.EqualFold(att.Name, want) {
				continue
			}
			for _, v := range att.Values {
				t := strings.ToLower(strings.TrimSpace(v.Value))
				if strings.Contains(t, "instructor") || strings.Contains(t, "teacher") || strings.Contains(t, "faculty") {
					return true
				}
			}
		}
	}
	return false
}
