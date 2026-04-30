// Package lti holds LTI 1.3 RSA / JWKS helpers (parity with server/src/lti_keys.rs public JWKS).
package lti

import (
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// RsaKeyPair holds parsed PKCS#8 private key and key id.
type RsaKeyPair struct {
	kid     string
	private *rsa.PrivateKey
}

// KeyID returns the LTI JOSE kid.
func (k *RsaKeyPair) KeyID() string { return k.kid }

// FromPKCS8PEM parses a PKCS#8 RSA private key PEM and wraps it with a kid
// (server/src/lti_keys.rs: LtiRsaKeyPair::from_pkcs8_pem).
func FromPKCS8PEM(pemData string, kid string) (*RsaKeyPair, error) {
	trim := strings.TrimSpace(pemData)
	if trim == "" {
		return nil, fmt.Errorf("lti: RSA private key PEM is empty")
	}
	block, _ := pem.Decode([]byte(trim))
	if block == nil {
		return nil, fmt.Errorf("lti: no PEM block in LTI private key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// try PKCS#1
		rsaK, e2 := x509.ParsePKCS1PrivateKey(block.Bytes)
		if e2 != nil {
			return nil, fmt.Errorf("lti: invalid LTI RSA private key PEM: %w", err)
		}
		return &RsaKeyPair{kid: kid, private: rsaK}, nil
	}
	rsaK, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("lti: PKCS#8 key is not RSA")
	}
	return &RsaKeyPair{kid: kid, private: rsaK}, nil
}

// jwkRsa matches json shape for one public key in JWKS.
type jwkRsa struct {
	Kty   string `json:"kty"`
	Kid   string `json:"kid"`
	Use   string `json:"use"`
	Alg   string `json:"alg"`
	N     string `json:"n"`
	E     string `json:"e"`
	X5S256 string `json:"x5t#S256"`
}

// JWKSJSON returns {"keys": [JWK...]} (Rust LtiRsaKeyPair::jwk_public_json + lti.rs jwks_json).
func (k *RsaKeyPair) JWKSJSON() (map[string]any, error) {
	pub := k.private.Public().(*rsa.PublicKey)
	n := pub.N.Bytes()
	e := bigEBytes(pub.E)
	enc := base64.RawURLEncoding
	thumb := jwkSHA256Thumbprint(n, e)
	j := jwkRsa{
		Kty:   "RSA",
		Kid:   k.kid,
		Use:   "sig",
		Alg:   "RS256",
		N:     enc.EncodeToString(n),
		E:     enc.EncodeToString(e),
		X5S256: thumb,
	}
	return map[string]any{"keys": []jwkRsa{j}}, nil
}

// JWKSBytes returns the JSON document (compact not required; stable fields).
func (k *RsaKeyPair) JWKSBytes() ([]byte, error) {
	m, err := k.JWKSJSON()
	if err != nil {
		return nil, err
	}
	return json.Marshal(m)
}

func bigEBytes(e int) []byte {
	bi := big.NewInt(int64(e))
	return bi.Bytes()
}

// jwkSHA256Thumbprint matches server/src/lti_keys: SHA256( n || b"." || e ) as base64url of raw 32 bytes.
func jwkSHA256Thumbprint(n, e []byte) string {
	h := sha256.New()
	h.Write(n)
	h.Write([]byte("."))
	h.Write(e)
	sum := h.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(sum)
}

// SignRS256HintJWT signs a minimal platform→tool launch hint (LTI 1.3) using this key pair.
func (k *RsaKeyPair) SignRS256HintJWT(claims map[string]any) (string, error) {
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims(claims))
	tok.Header["kid"] = k.kid
	if _, ok := claims["iss"]; !ok {
		return "", fmt.Errorf("lti: iss claim required")
	}
	if _, ok := claims["sub"]; !ok {
		return "", fmt.Errorf("lti: sub claim required")
	}
	return tok.SignedString(k.private)
}

// PlatformRS256Token builds claims for a launch hint (Rust build_platform_launch_hint_jwt).
func PlatformRS256TokenHints(platformBaseURL, toolIssuer, userID, courseID, itemID, locale string) (map[string]any, int64) {
	now := time.Now().UTC()
	iss := strings.TrimRight(strings.TrimSpace(platformBaseURL), "/")
	exp := now.Add(5 * time.Minute)
	if locale == "" {
		locale = "en-US"
	}
	target := fmt.Sprintf("%s/api/v1/lti/consumer/target?courseId=%s&itemId=%s", iss, courseID, itemID)
	claims := map[string]any{
		"iss": iss,
		"aud": toolIssuer,
		"sub": userID,
		"iat": now.Unix(),
		"exp": exp.Unix(),
		"https://purl.imsglobal.org/spec/lti/claim/deployment_id": "1",
		"https://purl.imsglobal.org/spec/lti/claim/target_link_uri":  target,
		"https://purl.imsglobal.org/spec/lti/claim/context":            map[string]any{"id": courseID},
		"https://purl.imsglobal.org/spec/lti/claim/custom": map[string]any{
			"courseId":        courseID,
			"structureItemId": itemID,
		},
		"https://purl.imsglobal.org/spec/lti/claim/launch_presentation": map[string]any{
			"locale": locale,
		},
	}
	return claims, exp.Unix()
}

