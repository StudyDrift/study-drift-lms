package lti

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func newKey(t *testing.T) (*rsa.PrivateKey, *RsaKeyPair) {
	t.Helper()
	pk, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(pk)
	if err != nil {
		t.Fatal(err)
	}
	pemData := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	pair, err := FromPKCS8PEM(pemData, "test-kid")
	if err != nil {
		t.Fatal(err)
	}
	return pk, pair
}

func signedIDToken(t *testing.T, pk *rsa.PrivateKey, iss, aud, nonce string, iat, exp time.Time) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":   iss,
		"aud":   aud,
		"sub":   "user-1",
		"nonce": nonce,
		"iat":   iat.Unix(),
		"exp":   exp.Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	s, err := tok.SignedString(pk)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestVerifyLtiIDToken_OK(t *testing.T) {
	pk, _ := newKey(t)
	now := time.Now()
	tok := signedIDToken(t, pk, "https://issuer", "client-x", "n1", now, now.Add(5*time.Minute))
	c, err := VerifyLtiIDToken(tok, &pk.PublicKey, "https://issuer", "client-x")
	if err != nil {
		t.Fatal(err)
	}
	if c.Nonce != "n1" {
		t.Fatal("nonce")
	}
}

func TestVerifyLtiIDToken_Errors(t *testing.T) {
	pk, _ := newKey(t)
	now := time.Now()
	_, err := VerifyLtiIDToken("", nil, "i", "a")
	if err == nil {
		t.Fatal("nil key")
	}
	tok := signedIDToken(t, pk, "https://issuer", "client-x", "n", now, now.Add(5*time.Minute))
	if _, err := VerifyLtiIDToken(tok, &pk.PublicKey, "wrong", "client-x"); err == nil {
		t.Fatal("iss mismatch")
	}
	if _, err := VerifyLtiIDToken(tok, &pk.PublicKey, "https://issuer", "wrong"); err == nil {
		t.Fatal("aud mismatch")
	}
	stale := signedIDToken(t, pk, "https://issuer", "client-x", "n", now.Add(-2*time.Hour), now)
	if _, err := VerifyLtiIDToken(stale, &pk.PublicKey, "https://issuer", "client-x"); err == nil {
		t.Fatal("stale iat")
	}
	if _, err := VerifyLtiIDToken("garbage", &pk.PublicKey, "i", "a"); err == nil {
		t.Fatal("garbage")
	}
}

func TestDecodeJWTPayloadJSON(t *testing.T) {
	payload := map[string]any{"a": "b"}
	pj, _ := json.Marshal(payload)
	tok := "h." + base64.RawURLEncoding.EncodeToString(pj) + ".sig"
	m, err := DecodeJWTPayloadJSON(tok)
	if err != nil || m["a"] != "b" {
		t.Fatalf("got %v err=%v", m, err)
	}
	if _, err := DecodeJWTPayloadJSON("only-one-segment"); err == nil {
		t.Fatal("malformed")
	}
	if _, err := DecodeJWTPayloadJSON("h.!!!.s"); err == nil {
		t.Fatal("bad b64")
	}
	bad := "h." + base64.RawURLEncoding.EncodeToString([]byte("not json")) + ".s"
	if _, err := DecodeJWTPayloadJSON(bad); err == nil {
		t.Fatal("bad json")
	}
}

func TestVerifyLtiBearerToken(t *testing.T) {
	pk, _ := newKey(t)
	now := time.Now()
	tok := signedIDToken(t, pk, "https://issuer", "any-aud", "", now, now.Add(5*time.Minute))
	if _, err := VerifyLtiBearerToken(tok, &pk.PublicKey, "https://issuer"); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyLtiBearerToken(tok, &pk.PublicKey, "wrong"); err == nil {
		t.Fatal("iss mismatch")
	}
	if _, err := VerifyLtiBearerToken("", nil, ""); err == nil {
		t.Fatal("nil pub")
	}
	expired := signedIDToken(t, pk, "https://issuer", "a", "", now.Add(-time.Hour), now.Add(-30*time.Minute))
	if _, err := VerifyLtiBearerToken(expired, &pk.PublicKey, "https://issuer"); err == nil {
		t.Fatal("expired")
	}
}

func TestVerifyToolBearerTokenForAGS(t *testing.T) {
	pk, _ := newKey(t)
	now := time.Now()
	tok := signedIDToken(t, pk, "https://issuer", "tool-aud", "", now, now.Add(5*time.Minute))
	if _, err := VerifyToolBearerTokenForAGS(tok, &pk.PublicKey, "https://issuer", "tool-aud"); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyToolBearerTokenForAGS(tok, &pk.PublicKey, "wrong", "tool-aud"); err == nil {
		t.Fatal("iss mismatch")
	}
	if _, err := VerifyToolBearerTokenForAGS(tok, &pk.PublicKey, "https://issuer", "wrong-aud"); err == nil {
		t.Fatal("aud mismatch")
	}
	if _, err := VerifyToolBearerTokenForAGS("", nil, "i", "a"); err == nil {
		t.Fatal("nil pub")
	}
}

func TestAudienceContains(t *testing.T) {
	if !audienceContains("x", "x") {
		t.Fatal("string match")
	}
	if audienceContains("x", "y") {
		t.Fatal("string no match")
	}
	if !audienceContains([]any{"a", "b", "x"}, "x") {
		t.Fatal("[]any match")
	}
	if audienceContains([]any{"a", 7}, "7") {
		t.Fatal("[]any only-strings")
	}
	if !audienceContains([]string{"a", "x"}, "x") {
		t.Fatal("[]string match")
	}
	if audienceContains([]string{"a"}, "x") {
		t.Fatal("[]string no match")
	}
	if audienceContains(123, "x") {
		t.Fatal("unknown type")
	}
}

func TestSignRS256HintJWT(t *testing.T) {
	_, pair := newKey(t)
	if _, err := pair.SignRS256HintJWT(map[string]any{"sub": "x"}); err == nil {
		t.Fatal("missing iss")
	}
	if _, err := pair.SignRS256HintJWT(map[string]any{"iss": "x"}); err == nil {
		t.Fatal("missing sub")
	}
	tok, err := pair.SignRS256HintJWT(map[string]any{"iss": "x", "sub": "y"})
	if err != nil || !strings.Contains(tok, ".") {
		t.Fatalf("got %q err=%v", tok, err)
	}
}

func TestPlatformRS256TokenHints(t *testing.T) {
	c, exp := PlatformRS256TokenHints("https://base/", "tool-iss", "u1", "c1", "i1", "")
	if c["iss"] != "https://base" {
		t.Fatalf("iss not trimmed: %v", c["iss"])
	}
	if exp <= time.Now().Unix() {
		t.Fatal("exp")
	}
	lp, _ := c["https://purl.imsglobal.org/spec/lti/claim/launch_presentation"].(map[string]any)
	if lp["locale"] != "en-US" {
		t.Fatalf("default locale: %v", lp)
	}
	c2, _ := PlatformRS256TokenHints("https://base", "t", "u", "c", "i", "fr-FR")
	lp2, _ := c2["https://purl.imsglobal.org/spec/lti/claim/launch_presentation"].(map[string]any)
	if lp2["locale"] != "fr-FR" {
		t.Fatal("locale override")
	}
}

func TestKeyID(t *testing.T) {
	_, pair := newKey(t)
	if pair.KeyID() != "test-kid" {
		t.Fatal("kid")
	}
}

func TestFromPKCS8PEM_EmptyAndPKCS1(t *testing.T) {
	if _, err := FromPKCS8PEM("", "k"); err == nil {
		t.Fatal("empty")
	}
	pk, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	der := x509.MarshalPKCS1PrivateKey(pk)
	pemData := string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: der}))
	if _, err := FromPKCS8PEM(pemData, "k"); err != nil {
		t.Fatalf("PKCS1 fallback: %v", err)
	}
}

func TestParseJWKSKeys(t *testing.T) {
	pk, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding
	n := enc.EncodeToString(pk.N.Bytes())
	e := enc.EncodeToString(bigEBytes(pk.E))
	body := []byte(`{"keys":[{"kty":"RSA","kid":"k1","use":"sig","n":"` + n + `","e":"` + e + `"}]}`)
	keys, err := parseJWKSKeys(body)
	if err != nil || keys["k1"] == nil {
		t.Fatalf("got keys=%v err=%v", keys, err)
	}
	// missing keys -> error
	if _, err := parseJWKSKeys([]byte(`{"keys":[]}`)); err == nil {
		t.Fatal("empty keys")
	}
	// bad json
	if _, err := parseJWKSKeys([]byte(`junk`)); err == nil {
		t.Fatal("bad json")
	}
	// non-RSA filtered, no-sig filtered
	useEnc := `"enc"`
	body2 := []byte(`{"keys":[{"kty":"oct","kid":"x"},{"kty":"RSA","kid":"k2","use":` + useEnc + `,"n":"` + n + `","e":"` + e + `"}]}`)
	if _, err := parseJWKSKeys(body2); err == nil {
		t.Fatal("expected no usable keys")
	}
	// missing n/e
	if _, err := parseJWKSKeys([]byte(`{"keys":[{"kty":"RSA","kid":"k"}]}`)); err == nil {
		t.Fatal("missing n/e -> no keys")
	}
}

func TestJwkRSAPublic_Errors(t *testing.T) {
	if _, err := jwkRSAPublic(&jwk{}); err == nil {
		t.Fatal("missing n/e")
	}
	bad := "!!!"
	good := base64.RawURLEncoding.EncodeToString([]byte{1, 2})
	if _, err := jwkRSAPublic(&jwk{N: &bad, E: &good}); err == nil {
		t.Fatal("bad n")
	}
	if _, err := jwkRSAPublic(&jwk{N: &good, E: &bad}); err == nil {
		t.Fatal("bad e")
	}
	zero := base64.RawURLEncoding.EncodeToString([]byte{0})
	if _, err := jwkRSAPublic(&jwk{N: &good, E: &zero}); err == nil {
		t.Fatal("bad exponent")
	}
}

func TestB64url(t *testing.T) {
	good := base64.RawURLEncoding.EncodeToString([]byte{1})
	if _, err := b64url(good); err != nil {
		t.Fatal(err)
	}
	if _, err := b64url("!!"); err == nil {
		t.Fatal("bad")
	}
}

func TestPublicKeyForJWT(t *testing.T) {
	pk, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding
	n := enc.EncodeToString(pk.N.Bytes())
	e := enc.EncodeToString(bigEBytes(pk.E))
	body := `{"keys":[{"kty":"RSA","kid":"k1","use":"sig","n":"` + n + `","e":"` + e + `"}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	header := map[string]string{"alg": "RS256", "kid": "k1"}
	hb, _ := json.Marshal(header)
	tok := enc.EncodeToString(hb) + ".eyJ9.sig"
	if _, err := PublicKeyForJWT(srv.URL, tok); err != nil {
		t.Fatal(err)
	}
	// cached on second call
	if _, err := PublicKeyForJWT(srv.URL, tok); err != nil {
		t.Fatal(err)
	}
	// malformed token
	if _, err := PublicKeyForJWT(srv.URL, "abc"); err == nil {
		t.Fatal("malformed")
	}
	// bad header b64
	if _, err := PublicKeyForJWT(srv.URL, "!!!.x.y"); err == nil {
		t.Fatal("bad b64")
	}
	// non-200 fetch
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer bad.Close()
	if _, err := PublicKeyForJWT(bad.URL, tok); err == nil {
		t.Fatal("expected fetch error")
	}
}

func TestB64urlJWT(t *testing.T) {
	in := base64.RawURLEncoding.EncodeToString([]byte("hello"))
	if _, err := b64urlJWT(in); err != nil {
		t.Fatal(err)
	}
	// no padding required
	if _, err := b64urlJWT("aGVsbG8"); err != nil {
		t.Fatal(err)
	}
}
