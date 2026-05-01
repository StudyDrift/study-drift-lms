// Package oidcauth implements browser OpenID Connect login (parity with server/src/services/auth/oidc and routes/oidc).
package oidcauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	oidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"

	pauth "github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	oidcrepo "github.com/lextures/lextures/server/internal/repos/oidc"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

// Service holds HTTP clients and a small discovery cache (parity with Rust OidcState).
type Service struct {
	Cfg     config.Config
	HTTP    *http.Client
	metaMu  sync.Mutex
	prov    map[string]provCache
	metaTTL time.Duration
}

type provCache struct {
	p  *oidc.Provider
	at time.Time
}

// NewService returns a non-nil service (handlers still check OIDCSSOEnabled).
func NewService(cfg config.Config) *Service {
	if strings.TrimSpace(cfg.OIDCPublicBaseURL) == "" {
		cfg.OIDCPublicBaseURL = strings.TrimSpace(cfg.LTIAPIBaseURL)
	}
	return &Service{
		Cfg:     cfg,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
		prov:    make(map[string]provCache),
		metaTTL: time.Hour,
	}
}

func redirectURIFor(publicBase, pathProvider string) string {
	b := strings.TrimRight(strings.TrimSpace(publicBase), "/")
	return fmt.Sprintf("%s/auth/oidc/%s/callback", b, pathProvider)
}

func randomURLToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func issuerForCustomDiscovery(discoveryURL string) (string, error) {
	t := strings.TrimSpace(discoveryURL)
	t = strings.TrimSuffix(t, "/.well-known/openid-configuration")
	t = strings.TrimRight(t, "/")
	if t == "" {
		return "", fmt.Errorf("empty discovery URL")
	}
	return t, nil
}

func (s *Service) providerForIssuer(ctx context.Context, issuer string) (*oidc.Provider, error) {
	now := time.Now()
	s.metaMu.Lock()
	if e, ok := s.prov[issuer]; ok && now.Sub(e.at) < s.metaTTL {
		p := e.p
		s.metaMu.Unlock()
		return p, nil
	}
	s.metaMu.Unlock()
	p, err := oidc.NewProvider(oidc.ClientContext(ctx, s.HTTP), issuer)
	if err != nil {
		return nil, err
	}
	s.metaMu.Lock()
	s.prov[issuer] = provCache{p: p, at: time.Now()}
	s.metaMu.Unlock()
	return p, nil
}

// BuildAuthorizeRedirectURL returns a temporary redirect target for the IdP (GET /auth/oidc/{provider}/login).
func (s *Service) BuildAuthorizeRedirectURL(
	ctx context.Context, pool *pgxpool.Pool,
	pathProvider string,
	configID, linkID *uuid.UUID,
	next *string,
) (string, error) {
	if !s.oidcFlowAllowed(pathProvider) {
		return "", authservice.FieldError{Message: "OpenID Connect is not enabled on this server."}
	}
	pv := strings.ToLower(strings.TrimSpace(pathProvider))
	_ = oidcrepo.DeleteStaleFlowState(ctx, pool)
	_ = oidcrepo.DeleteStaleLinkIntents(ctx, pool)

	var forUser *uuid.UUID
	if linkID != nil {
		uid, p, custom, ok, err := oidcrepo.TakeLinkIntent(ctx, pool, *linkID)
		if err != nil {
			return "", err
		}
		if !ok {
			return "", authservice.FieldError{Message: "Sign-in link expired or was already used."}
		}
		if p != pv {
			return "", authservice.FieldError{Message: "This sign-in link is for a different provider."}
		}
		if pv == "custom" {
			if custom == nil || configID == nil || *configID != *custom {
				return "", authservice.FieldError{Message: "This sign-in link is for a different custom provider."}
			}
		} else if custom != nil {
			return "", authservice.FieldError{Message: "Invalid sign-in link."}
		}
		forUser = &uid
	}

	var customRow *oidcrepo.CustomProviderRow
	if pv == "custom" {
		if configID == nil {
			return "", authservice.FieldError{Message: "Missing configId for custom OIDC."}
		}
		var err error
		customRow, err = oidcrepo.GetCustomByID(ctx, pool, *configID)
		if err != nil {
			return "", err
		}
		if customRow == nil {
			return "", authservice.FieldError{Message: "Unknown custom OIDC configuration."}
		}
	}

	issuer, clientID, clientSecret, hd, err := s.resolveClient(pv, customRow)
	if err != nil {
		return "", err
	}
	prov, err := s.providerForIssuer(ctx, issuer)
	if err != nil {
		return "", authservice.FieldError{Message: "Could not contact the identity provider (OIDC discovery failed)."}
	}
	redirect := redirectURIFor(s.Cfg.OIDCPublicBaseURL, pv)
	o2 := oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirect,
		Endpoint:     prov.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "email", "profile"},
	}
	verifier := oauth2.GenerateVerifier()
	state := randomURLToken()
	nonce := randomURLToken()
	opts := []oauth2.AuthCodeOption{
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("nonce", nonce),
	}
	if pv == "google" && strings.TrimSpace(hd) != "" {
		opts = append(opts, oauth2.SetAuthURLParam("hd", strings.TrimSpace(hd)))
	}
	authURL := o2.AuthCodeURL(state, opts...)

	var customID *uuid.UUID
	if customRow != nil {
		cid := customRow.ID
		customID = &cid
	}
	if err := oidcrepo.SaveFlowState(ctx, pool, state, nonce, verifier, pv, customID, forUser, next); err != nil {
		return "", err
	}
	return authURL, nil
}

func (s *Service) resolveClient(pathProvider string, custom *oidcrepo.CustomProviderRow) (issuer, clientID, clientSecret, hd string, err error) {
	switch pathProvider {
	case "google":
		if s.Cfg.OIDCGoogleClientID == "" || s.Cfg.OIDCGoogleClientSecret == "" {
			return "", "", "", "", authservice.FieldError{Message: "Google sign-in is not configured."}
		}
		return "https://accounts.google.com", s.Cfg.OIDCGoogleClientID, s.Cfg.OIDCGoogleClientSecret, s.Cfg.OIDCGoogleHostedDomain, nil
	case "microsoft":
		if s.Cfg.OIDCMicrosoftClientID == "" || s.Cfg.OIDCMicrosoftClientSecret == "" || s.Cfg.OIDCMicrosoftTenant == "" {
			return "", "", "", "", authservice.FieldError{Message: "Microsoft sign-in is not configured."}
		}
		tenant := strings.TrimSpace(s.Cfg.OIDCMicrosoftTenant)
		iss := fmt.Sprintf("https://login.microsoftonline.com/%s/v2.0", tenant)
		return iss, s.Cfg.OIDCMicrosoftClientID, s.Cfg.OIDCMicrosoftClientSecret, "", nil
	case "apple":
		if s.Cfg.OIDCAppleClientID == "" {
			return "", "", "", "", authservice.FieldError{Message: "Apple sign-in is not configured."}
		}
		sec, e := AppleClientSecretJWT(s.Cfg)
		if e != nil {
			return "", "", "", "", authservice.FieldError{Message: e.Error()}
		}
		return "https://appleid.apple.com", s.Cfg.OIDCAppleClientID, sec, "", nil
	case "custom":
		if custom == nil {
			return "", "", "", "", authservice.FieldError{Message: "A custom OIDC configuration is required here."}
		}
		iss, e := issuerForCustomDiscovery(custom.DiscoveryURL)
		if e != nil {
			return "", "", "", "", authservice.FieldError{Message: fmt.Sprintf("Invalid custom discovery URL: %v", e)}
		}
		var hdVal string
		if custom.HDRestriction != nil {
			hdVal = *custom.HDRestriction
		}
		return iss, custom.ClientID, custom.ClientSecret, hdVal, nil
	case "clever":
		if !s.Cfg.CleverSSOEnabled || s.Cfg.CleverOIDCClientID == "" || s.Cfg.CleverOIDCClientSecret == "" {
			return "", "", "", "", authservice.FieldError{Message: "Clever sign-in is not configured."}
		}
		return "https://clever.com", s.Cfg.CleverOIDCClientID, s.Cfg.CleverOIDCClientSecret, "", nil
	case "classlink":
		if !s.Cfg.ClassLinkSSOEnabled || s.Cfg.ClassLinkOIDCClientID == "" || s.Cfg.ClassLinkOIDCClientSecret == "" {
			return "", "", "", "", authservice.FieldError{Message: "ClassLink sign-in is not configured."}
		}
		return "https://launchpad.classlink.com", s.Cfg.ClassLinkOIDCClientID, s.Cfg.ClassLinkOIDCClientSecret, "", nil
	default:
		return "", "", "", "", authservice.FieldError{Message: "Unknown OIDC provider."}
	}
}

// CompleteLogin finishes the callback: exchanges the code, verifies the ID token, issues an app JWT.
func (s *Service) CompleteLogin(
	ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner,
	pathProvider, code, state string,
) (authservice.AuthResponse, *string, error) {
	if !s.oidcFlowAllowed(pathProvider) {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "OpenID Connect is not enabled on this server."}
	}
	_ = oidcrepo.DeleteStaleFlowState(ctx, pool)
	pv := strings.ToLower(strings.TrimSpace(pathProvider))
	flow, err := oidcrepo.TakeFlowState(ctx, pool, state)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if flow == nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Sign-in could not be completed. Please start again from the login page."}
	}
	if flow.Provider != pv {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Invalid sign-in state. Please start again from the login page."}
	}
	var customRow *oidcrepo.CustomProviderRow
	if flow.CustomConfigID != nil {
		customRow, err = oidcrepo.GetCustomByID(ctx, pool, *flow.CustomConfigID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if customRow == nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "The OIDC configuration no longer exists."}
		}
	}
	issuer, clientID, staticSecret, _, err := s.resolveClient(pv, customRow)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	prov, err := s.providerForIssuer(ctx, issuer)
	if err != nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Could not contact the identity provider (OIDC discovery failed)."}
	}
	redirect := redirectURIFor(s.Cfg.OIDCPublicBaseURL, pv)
	secret := staticSecret
	if pv == "apple" {
		sec, e := AppleClientSecretJWT(s.Cfg)
		if e != nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: e.Error()}
		}
		secret = sec
	}
	o2 := oauth2.Config{
		ClientID:     clientID,
		ClientSecret: secret,
		RedirectURL:  redirect,
		Endpoint:     prov.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "email", "profile"},
	}
	ctx2 := oidc.ClientContext(ctx, s.HTTP)
	tok, err := o2.Exchange(ctx2, code, oauth2.VerifierOption(flow.CodeVerifier))
	if err != nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Could not complete sign-in with the identity provider."}
	}
	if pv == "clever" || pv == "classlink" {
		return s.completeK12OIDCLogin(ctx, pool, jwt, pv, flow, prov, o2, tok)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "The identity provider did not return an ID token."}
	}
	ver := prov.Verifier(&oidc.Config{ClientID: clientID})
	ctxO := oidc.ClientContext(ctx, s.HTTP)
	idToken, err := ver.Verify(ctxO, raw)
	if err != nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: fmt.Sprintf("Invalid ID token: %v", err)}
	}
	var c struct {
		Sub    string  `json:"sub"`
		Nonce  string  `json:"nonce"`
		Email  string  `json:"email"`
		ATHash *string `json:"at_hash"`
	}
	if err := idToken.Claims(&c); err != nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Invalid ID token claims."}
	}
	if err := verifyATHash(c.ATHash, tok.AccessToken); err != nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: err.Error()}
	}
	if c.Nonce != flow.Nonce {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Invalid sign-in (nonce)."}
	}
	emailIn := user.NormalizeEmail(c.Email)
	if emailIn == "" || !strings.Contains(emailIn, "@") {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "The identity provider did not return a usable email address."}
	}
	if err := checkHostedDomain(pv, s.Cfg, customRow, emailIn); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	subj := c.Sub
	if subj == "" {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "The identity provider did not return a subject."}
	}

	ident, err := oidcrepo.FindIdentityByProviderAndSub(ctx, pool, pv, subj)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if ident != nil {
		u, err := user.FindByID(ctx, pool, ident.UserID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if u == nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "User not found."}
		}
		res, err := authservice.AuthResponseForUser(jwt, u)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		return res, flow.NextPath, nil
	}
	if flow.ForUserID != nil {
		u, err := user.FindByID(ctx, pool, *flow.ForUserID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if u == nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "User not found."}
		}
		if user.NormalizeEmail(u.Email) != emailIn {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "The signed-in account email does not match the account you are connecting."}
		}
		uid, err := uuid.Parse(u.ID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if _, err := oidcrepo.TryInsertIdentity(ctx, pool, uid, pv, subj, &emailIn); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		res, err := authservice.AuthResponseForUser(jwt, u)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		return res, flow.NextPath, nil
	}
	if u, err := user.FindByEmail(ctx, pool, emailIn); err != nil {
		return authservice.AuthResponse{}, nil, err
	} else if u != nil {
		uid, err := uuid.Parse(u.ID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if _, err := oidcrepo.TryInsertIdentity(ctx, pool, uid, pv, subj, &emailIn); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		res, err := authservice.AuthResponseForUser(jwt, u)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		return res, flow.NextPath, nil
	}
	ph, err := authservice.PlaceholderPasswordHash()
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	nu, err := user.InsertUser(ctx, pool, emailIn, ph, nil)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	uid, err := uuid.Parse(nu.ID)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, uid, "Student"); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if _, err := oidcrepo.TryInsertIdentity(ctx, pool, uid, pv, subj, &emailIn); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	res, err := authservice.AuthResponseForUser(jwt, nu)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	return res, flow.NextPath, nil
}

func checkHostedDomain(pathProvider string, cfg config.Config, custom *oidcrepo.CustomProviderRow, emailIn string) error {
	low := strings.ToLower(emailIn)
	if pathProvider == "google" {
		if want := strings.TrimSpace(cfg.OIDCGoogleHostedDomain); want != "" {
			suf := "@" + strings.ToLower(want)
			if !strings.HasSuffix(low, suf) {
				return authservice.FieldError{Message: "Your account is not in the allowed Google Workspace domain for this app."}
			}
		}
	}
	if pathProvider == "custom" && custom != nil && custom.HDRestriction != nil {
		want := strings.TrimSpace(*custom.HDRestriction)
		if want != "" {
			suf := "@" + strings.ToLower(want)
			if !strings.HasSuffix(low, suf) {
				return authservice.FieldError{Message: "Your account is not in the allowed domain for this app."}
			}
		}
	}
	return nil
}

func verifyATHash(atHash *string, accessToken string) error {
	if atHash == nil || *atHash == "" {
		return nil
	}
	if accessToken == "" {
		return fmt.Errorf("Access token did not match ID token (at_hash).")
	}
	h := sha256.Sum256([]byte(accessToken))
	half := h[:len(h)/2]
	b64 := base64.RawURLEncoding.EncodeToString(half)
	if b64 != *atHash {
		return fmt.Errorf("Access token did not match ID token (at_hash).")
	}
	return nil
}

// PublicWebBase returns the trimmed public web origin for post-login HTML redirects.
func (s *Service) PublicWebBase() string {
	return strings.TrimRight(strings.TrimSpace(s.Cfg.PublicWebOrigin), "/")
}
