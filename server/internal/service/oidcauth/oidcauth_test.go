package oidcauth

import "testing"

func TestRedirectURIFor(t *testing.T) {
	if got := redirectURIFor("http://api:8080", "google"); got != "http://api:8080/auth/oidc/google/callback" {
		t.Fatalf("google: %q", got)
	}
	if got := redirectURIFor("http://api:8080/", "custom"); got != "http://api:8080/auth/oidc/custom/callback" {
		t.Fatalf("custom: %q", got)
	}
	if got := redirectURIFor("http://api:8080", "clever"); got != "http://api:8080/auth/oidc/clever/callback" {
		t.Fatalf("clever: %q", got)
	}
}

func TestIssuerForCustomDiscovery(t *testing.T) {
	iss, err := issuerForCustomDiscovery("  https://idp.example.com/.well-known/openid-configuration  ")
	if err != nil || iss != "https://idp.example.com" {
		t.Fatalf("got %q %v", iss, err)
	}
	iss, err = issuerForCustomDiscovery("https://idp.example.com")
	if err != nil || iss != "https://idp.example.com" {
		t.Fatalf("got %q %v", iss, err)
	}
}
