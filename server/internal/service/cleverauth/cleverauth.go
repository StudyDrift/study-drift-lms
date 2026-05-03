// Package cleverauth implements Clever Instant Login (OAuth 2.0 + PKCE) and JIT user provisioning (plan 4.4).
package cleverauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	pauth "github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	cleverrepo "github.com/lextures/lextures/server/internal/repos/clever"
	oidcrepo "github.com/lextures/lextures/server/internal/repos/oidc"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

const defaultCleverAuthorizeURL = "https://clever.com/oauth/authorize"
const defaultCleverTokenURL = "https://clever.com/oauth/tokens"
const defaultCleverAPIBase = "https://api.clever.com/v3.0"

// Service holds HTTP client for Clever APIs.
type Service struct {
	Cfg             config.Config
	HTTP            *http.Client
	AuthorizeURL    string
	TokenURL        string
	CleverAPIBase   string
}

// NewService returns a Clever auth service (handlers still check CleverSSOEnabled).
func NewService(cfg config.Config) *Service {
	if strings.TrimSpace(cfg.OIDCPublicBaseURL) == "" {
		cfg.OIDCPublicBaseURL = strings.TrimSpace(cfg.LTIAPIBaseURL)
	}
	return &Service{
		Cfg:           cfg,
		HTTP:          &http.Client{Timeout: 30 * time.Second},
		AuthorizeURL:  defaultCleverAuthorizeURL,
		TokenURL:      defaultCleverTokenURL,
		CleverAPIBase: defaultCleverAPIBase,
	}
}

func cleverCallbackURL(publicBase string) string {
	b := strings.TrimRight(strings.TrimSpace(publicBase), "/")
	return b + "/auth/clever/callback"
}

func randomURLToken() string {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

// BuildAuthorizeRedirectURL returns Clever's authorize URL and persists PKCE state.
func (s *Service) BuildAuthorizeRedirectURL(ctx context.Context, pool *pgxpool.Pool, next *string) (string, error) {
	if !s.Cfg.CleverSSOEnabled {
		return "", authservice.FieldError{Message: "Clever sign-in is not enabled on this server."}
	}
	if strings.TrimSpace(s.Cfg.CleverClientID) == "" || strings.TrimSpace(s.Cfg.CleverClientSecret) == "" {
		return "", authservice.FieldError{Message: "Clever is not configured (missing client id or secret)."}
	}
	_ = cleverrepo.DeleteStaleFlowState(ctx, pool)

	verifier := oauth2Verifier()
	challenge := pkceChallengeS256(verifier)
	state := randomURLToken()

	if err := cleverrepo.SaveFlowState(ctx, pool, state, verifier, next); err != nil {
		return "", err
	}

	redir := cleverCallbackURL(s.Cfg.OIDCPublicBaseURL)
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", strings.TrimSpace(s.Cfg.CleverClientID))
	q.Set("redirect_uri", redir)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	if d := strings.TrimSpace(s.Cfg.CleverDistrictID); d != "" {
		q.Set("district_id", d)
	}
	return s.AuthorizeURL + "?" + q.Encode(), nil
}

func oauth2Verifier() string {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

func pkceChallengeS256(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// CompleteLogin exchanges the code, loads Clever profile, issues an app JWT.
func (s *Service) CompleteLogin(ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner, code, state string, meta *authservice.ClientMeta) (authservice.AuthResponse, *string, error) {
	if !s.Cfg.CleverSSOEnabled {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Clever sign-in is not enabled on this server."}
	}
	_ = cleverrepo.DeleteStaleFlowState(ctx, pool)
	if strings.TrimSpace(code) == "" {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Missing authorization code."}
	}
	if strings.TrimSpace(state) == "" {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Missing state parameter. Open the “Log in with Clever” link from this app so sign-in can complete securely."}
	}
	flow, err := cleverrepo.TakeFlowState(ctx, pool, state)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if flow == nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Sign-in could not be completed. Please start again from the login page."}
	}

	access, err := s.exchangeCode(ctx, code, flow.CodeVerifier)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}

	meID, meDistrict, err := s.fetchMe(ctx, access)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if meID == "" {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Clever did not return a user id."}
	}
	_ = meDistrict // reserved for future district-scoped provisioning

	prof, err := s.fetchUserProfile(ctx, access, meID)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}

	email := user.NormalizeEmail(prof.Email)
	if email == "" || !strings.Contains(email, "@") {
		email = placeholderCleverEmail(meID)
	}

	subj := meID
	if u, err := user.FindByCleverID(ctx, pool, subj); err != nil {
		return authservice.AuthResponse{}, nil, err
	} else if u != nil {
		uid, err := uuid.Parse(u.ID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if err := user.UpdateCleverMinorFlag(ctx, pool, uid, prof.IsMinor); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		u2, err := user.FindByID(ctx, pool, uid)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if u2 == nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "User not found."}
		}
		res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, u2, meta)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		return res, flow.NextPath, nil
	}

	if ident, err := oidcrepo.FindIdentityByProviderAndSub(ctx, pool, "clever", subj); err != nil {
		return authservice.AuthResponse{}, nil, err
	} else if ident != nil {
		u, err := user.FindByID(ctx, pool, ident.UserID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if u == nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "User not found."}
		}
		if err := user.SetCleverID(ctx, pool, ident.UserID, subj); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if err := user.UpdateCleverMinorFlag(ctx, pool, ident.UserID, prof.IsMinor); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		u2, err := user.FindByID(ctx, pool, ident.UserID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, u2, meta)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		return res, flow.NextPath, nil
	}

	if u, err := user.FindByEmailCI(ctx, pool, email); err != nil {
		return authservice.AuthResponse{}, nil, err
	} else if u != nil {
		uid, err := uuid.Parse(u.ID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if err := user.SetCleverID(ctx, pool, uid, subj); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if err := user.UpdateCleverMinorFlag(ctx, pool, uid, prof.IsMinor); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if _, err := oidcrepo.TryInsertIdentity(ctx, pool, uid, "clever", subj, &email); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		u2, err := user.FindByID(ctx, pool, uid)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, u2, meta)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		return res, flow.NextPath, nil
	}

	ph, err := authservice.PlaceholderPasswordHash()
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	var dn *string
	if prof.DisplayName != "" {
		d := prof.DisplayName
		dn = &d
	}
	nu, err := user.InsertUserWithClever(ctx, pool, email, ph, dn, subj, prof.IsMinor)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	uid, err := uuid.Parse(nu.ID)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	roleName := rbacRoleForClever(prof.RoleHint)
	if err := rbac.AssignUserRoleByName(ctx, pool, uid, roleName); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if _, err := oidcrepo.TryInsertIdentity(ctx, pool, uid, "clever", subj, &email); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, nu, meta)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	return res, flow.NextPath, nil
}

func placeholderCleverEmail(cleverUserID string) string {
	return fmt.Sprintf("clever+%s@users.noreply.clever.lextures.invalid", strings.ToLower(strings.TrimSpace(cleverUserID)))
}

func rbacRoleForClever(roleHint string) string {
	switch strings.ToLower(strings.TrimSpace(roleHint)) {
	case "district_admin", "districtadmin", "administrator", "admin":
		return "Global Admin"
	case "teacher", "staff":
		return "Teacher"
	case "student", "":
		return "Student"
	default:
		return "Student"
	}
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
}

func (s *Service) exchangeCode(ctx context.Context, code, verifier string) (string, error) {
	redir := cleverCallbackURL(s.Cfg.OIDCPublicBaseURL)
	body := map[string]string{
		"code":          code,
		"grant_type":    "authorization_code",
		"redirect_uri":  redir,
		"code_verifier": verifier,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.TokenURL, strings.NewReader(string(raw)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	cid := strings.TrimSpace(s.Cfg.CleverClientID)
	sec := strings.TrimSpace(s.Cfg.CleverClientSecret)
	req.SetBasicAuth(cid, sec)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return "", authservice.FieldError{Message: "Could not reach Clever to complete sign-in."}
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", authservice.FieldError{Message: "Clever rejected the sign-in token exchange."}
	}
	var tr tokenResponse
	if err := json.Unmarshal(b, &tr); err != nil || strings.TrimSpace(tr.AccessToken) == "" {
		return "", authservice.FieldError{Message: "Clever returned an unexpected token response."}
	}
	return tr.AccessToken, nil
}

type meEnvelope struct {
	Data struct {
		ID       string `json:"id"`
		District string `json:"district"`
	} `json:"data"`
}

func (s *Service) fetchMe(ctx context.Context, access string) (userID, districtID string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.CleverAPIBase+"/me", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return "", "", authservice.FieldError{Message: "Could not load your Clever profile."}
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", authservice.FieldError{Message: "Clever /me request failed."}
	}
	var env meEnvelope
	if err := json.Unmarshal(b, &env); err != nil {
		return "", "", authservice.FieldError{Message: "Could not parse Clever /me response."}
	}
	return strings.TrimSpace(env.Data.ID), strings.TrimSpace(env.Data.District), nil
}

type cleverProfile struct {
	Email       string
	DisplayName string
	RoleHint    string
	IsMinor     bool
}

func (s *Service) fetchUserProfile(ctx context.Context, access, cleverUserID string) (cleverProfile, error) {
	u := fmt.Sprintf("%s/users/%s", s.CleverAPIBase, url.PathEscape(cleverUserID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return cleverProfile{}, err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return cleverProfile{}, authservice.FieldError{Message: "Could not load Clever user details."}
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Fall back to minimal profile from /me only
		return cleverProfile{}, nil
	}
	var root map[string]any
	if err := json.Unmarshal(b, &root); err != nil {
		return cleverProfile{}, authservice.FieldError{Message: "Could not parse Clever user response."}
	}
	data, _ := root["data"].(map[string]any)
	inner, _ := data["data"].(map[string]any)
	prof := cleverProfile{}
	if v, ok := inner["email"].(string); ok {
		prof.Email = v
	}
	if name, ok := inner["name"].(map[string]any); ok {
		fn, _ := name["first"].(string)
		ln, _ := name["last"].(string)
		prof.DisplayName = strings.TrimSpace(strings.TrimSpace(fn) + " " + strings.TrimSpace(ln))
	}
	if r, ok := inner["roles"].(map[string]any); ok {
		if rt, ok := r["teacher"].(map[string]any); ok {
			if rt != nil {
				prof.RoleHint = "teacher"
			}
		}
		if rs, ok := r["student"].(map[string]any); ok {
			if rs != nil && prof.RoleHint == "" {
				prof.RoleHint = "student"
			}
		}
		if rd, ok := r["district_admin"].(map[string]any); ok {
			if rd != nil {
				prof.RoleHint = "district_admin"
			}
		}
	}
	if prof.RoleHint == "" {
		if rt, ok := inner["role"].(string); ok {
			prof.RoleHint = rt
		}
	}
	if v, ok := inner["is_under_13"].(bool); ok {
		prof.IsMinor = v
	}
	return prof, nil
}

// PublicWebBase returns the trimmed public web origin for post-login HTML redirects.
func (s *Service) PublicWebBase() string {
	return strings.TrimRight(strings.TrimSpace(s.Cfg.PublicWebOrigin), "/")
}
