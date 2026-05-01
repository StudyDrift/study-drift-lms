package oidcauth

import (
	"testing"

	"github.com/lextures/lextures/server/internal/config"
)

func TestOIDCFlowAllowed_K12WithoutGlobalOIDC(t *testing.T) {
	s := NewService(config.Config{
		OIDCSSOEnabled:            false,
		CleverSSOEnabled:          true,
		CleverOIDCClientID:        "id",
		CleverOIDCClientSecret:    "sec",
		ClassLinkSSOEnabled:       true,
		ClassLinkOIDCClientID:     "id2",
		ClassLinkOIDCClientSecret: "sec2",
	})
	if !s.oidcFlowAllowed("clever") {
		t.Fatal("clever should be allowed")
	}
	if !s.oidcFlowAllowed("classlink") {
		t.Fatal("classlink should be allowed")
	}
	if s.oidcFlowAllowed("google") {
		t.Fatal("google should not be allowed without OIDC_SSO_ENABLED")
	}
}

func TestParseClassLinkUserInfoClaims(t *testing.T) {
	p := ParseClassLinkUserInfoClaims(map[string]any{
		"email":               "T@School.EDU",
		"given_name":          "Pat",
		"family_name":         "Lee",
		"classLink_sourcedId": "src-1",
		"classLink_role":    "Teacher",
	})
	if p.Email != "t@school.edu" || p.GivenName != "Pat" || p.FamilyName != "Lee" || p.SourcedID != "src-1" || p.RoleName != "Teacher" {
		t.Fatalf("unexpected profile: %+v", p)
	}
	p2 := ParseClassLinkUserInfoClaims(map[string]any{"email": "s@x.com"})
	if p2.RoleName != "Student" {
		t.Fatalf("want Student, got %q", p2.RoleName)
	}
}
