package oidcauth

import (
	"context"
	"strings"

	oidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"

	pauth "github.com/lextures/lextures/server/internal/auth"
	oidcrepo "github.com/lextures/lextures/server/internal/repos/oidc"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

func (s *Service) oidcFlowAllowed(pathProvider string) bool {
	pv := strings.ToLower(strings.TrimSpace(pathProvider))
	if s.Cfg.OIDCSSOEnabled {
		return true
	}
	if pv == "clever" && s.Cfg.CleverSSOEnabled && s.Cfg.CleverConfigured() {
		return true
	}
	if pv == "classlink" && s.Cfg.ClassLinkSSOEnabled && s.Cfg.ClassLinkOIDCConfigured() {
		return true
	}
	return false
}

// completeK12OIDCLogin finishes Clever or ClassLink after the OAuth code exchange (no ID token required).
func (s *Service) completeK12OIDCLogin(
	ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner,
	pv string, flow *oidcrepo.FlowStateRow,
	prov *oidc.Provider, o2 oauth2.Config, tok *oauth2.Token,
) (authservice.AuthResponse, *string, error) {
	if tok == nil || strings.TrimSpace(tok.AccessToken) == "" {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "The identity provider did not return an access token."}
	}
	var emailIn, subj string
	var roleName string
	var cleverID, classlinkID *string
	var isMinor bool
	var givenName, familyName *string
	connectedVia := pv

	switch pv {
	case "clever":
		me, err := FetchCleverMe(ctx, s.HTTP, tok.AccessToken)
		if err != nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Could not load your Clever profile. Please try again."}
		}
		if strings.TrimSpace(me.UserID) == "" {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Clever did not return a user id."}
		}
		em := user.NormalizeEmail(me.Email)
		if em == "" || !strings.Contains(em, "@") {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Clever did not return a usable email address."}
		}
		emailIn = em
		subj = me.UserID
		roleName = me.RoleName
		isMinor = me.IsMinor
		if me.GivenName != "" {
			g := me.GivenName
			givenName = &g
		}
		if me.FamilyName != "" {
			f := me.FamilyName
			familyName = &f
		}
		cid := me.UserID
		cleverID = &cid
	case "classlink":
		ctxU := oidc.ClientContext(ctx, s.HTTP)
		ui, err := prov.UserInfo(ctxU, oauth2.StaticTokenSource(tok))
		if err != nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Could not load your ClassLink profile. Please try again."}
		}
		var raw map[string]any
		if err := ui.Claims(&raw); err != nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Could not read ClassLink profile claims."}
		}
		cl := ParseClassLinkUserInfoClaims(raw)
		em := user.NormalizeEmail(cl.Email)
		if em == "" || !strings.Contains(em, "@") {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "ClassLink did not return a usable email address."}
		}
		emailIn = em
		if strings.TrimSpace(cl.SourcedID) != "" {
			subj = strings.TrimSpace(cl.SourcedID)
		} else {
			subj = "email:" + em
		}
		roleName = cl.RoleName
		if cl.GivenName != "" {
			g := cl.GivenName
			givenName = &g
		}
		if cl.FamilyName != "" {
			f := cl.FamilyName
			familyName = &f
		}
		sid := strings.TrimSpace(cl.SourcedID)
		if sid != "" {
			classlinkID = &sid
		}
	default:
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "Unknown K-12 provider."}
	}
	if roleName == "" {
		roleName = "Student"
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
		uid, err := uuid.Parse(u.ID)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if err := user.UpdateK12ProfileAfterOIDC(ctx, pool, uid, cleverID, classlinkID, isMinor, givenName, familyName, connectedVia); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		u2, err := user.FindByID(ctx, pool, uid)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		if u2 == nil {
			return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "User not found."}
		}
		res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, u2)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		return res, flow.NextPath, nil
	}

	if pv == "clever" && cleverID != nil {
		if u, err := user.FindByCleverID(ctx, pool, *cleverID); err != nil {
			return authservice.AuthResponse{}, nil, err
		} else if u != nil {
			return s.finishK12ExistingUser(ctx, pool, jwt, u, pv, subj, emailIn, cleverID, classlinkID, isMinor, givenName, familyName, connectedVia, flow.NextPath)
		}
	}
	if pv == "classlink" && classlinkID != nil {
		if u, err := user.FindByClassLinkID(ctx, pool, *classlinkID); err != nil {
			return authservice.AuthResponse{}, nil, err
		} else if u != nil {
			return s.finishK12ExistingUser(ctx, pool, jwt, u, pv, subj, emailIn, cleverID, classlinkID, isMinor, givenName, familyName, connectedVia, flow.NextPath)
		}
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
		if err := user.UpdateK12ProfileAfterOIDC(ctx, pool, uid, cleverID, classlinkID, isMinor, givenName, familyName, connectedVia); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		u2, err := user.FindByID(ctx, pool, uid)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, u2)
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
		if err := user.UpdateK12ProfileAfterOIDC(ctx, pool, uid, cleverID, classlinkID, isMinor, givenName, familyName, connectedVia); err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		u2, err := user.FindByID(ctx, pool, uid)
		if err != nil {
			return authservice.AuthResponse{}, nil, err
		}
		res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, u2)
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
	if err := rbac.AssignUserRoleByName(ctx, pool, uid, roleName); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if _, err := oidcrepo.TryInsertIdentity(ctx, pool, uid, pv, subj, &emailIn); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if err := user.UpdateK12ProfileAfterOIDC(ctx, pool, uid, cleverID, classlinkID, isMinor, givenName, familyName, connectedVia); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	u3, err := user.FindByID(ctx, pool, uid)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if u3 == nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "User not found."}
	}
	res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, u3)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	return res, flow.NextPath, nil
}

func (s *Service) finishK12ExistingUser(
	ctx context.Context, pool *pgxpool.Pool, jwt *pauth.JWTSigner,
	u *user.Row, pv, subj, emailIn string,
	cleverID, classlinkID *string, isMinor bool, givenName, familyName *string, connectedVia string,
	nextPath *string,
) (authservice.AuthResponse, *string, error) {
	uid, err := uuid.Parse(u.ID)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if _, err := oidcrepo.TryInsertIdentity(ctx, pool, uid, pv, subj, &emailIn); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if err := user.UpdateK12ProfileAfterOIDC(ctx, pool, uid, cleverID, classlinkID, isMinor, givenName, familyName, connectedVia); err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	u2, err := user.FindByID(ctx, pool, uid)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	if u2 == nil {
		return authservice.AuthResponse{}, nil, authservice.FieldError{Message: "User not found."}
	}
	res, err := authservice.AuthResponseForUser(ctx, pool, jwt, s.Cfg, u2)
	if err != nil {
		return authservice.AuthResponse{}, nil, err
	}
	return res, nextPath, nil
}
