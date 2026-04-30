package lti

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// LtiIDTokenClaims is the minimal claim set for LTI 1.3 id_token verification (parent platform).
type LtiIDTokenClaims struct {
	jwt.RegisteredClaims
	Nonce string  `json:"nonce"`
	Email *string `json:"email,omitempty"`
	Name  *string `json:"name,omitempty"`
}

// VerifyLtiIDToken verifies RS256, issuer, audience, exp, and iat skew (±10 min) like Rust.
func VerifyLtiIDToken(token string, pub *rsa.PublicKey, iss, clientID string) (*LtiIDTokenClaims, error) {
	if pub == nil {
		return nil, errors.New("lti: nil public key")
	}
	p := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithLeeway(60*time.Second),
	)
	claims := &LtiIDTokenClaims{}
	_, err := p.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
		return pub, nil
	})
	if err != nil {
		return nil, fmt.Errorf("lti: invalid id token: %w", err)
	}
	if claims.Issuer != iss {
		return nil, errors.New("lti: iss mismatch")
	}
	if !claimStringsMatch(claims.Audience, clientID) {
		return nil, errors.New("lti: aud mismatch")
	}
	now := time.Now().UTC().Unix()
	if claims.IssuedAt == nil {
		return nil, errors.New("lti: iat required")
	}
	iat := claims.IssuedAt.Unix()
	if (now-iat) > 600 || (iat-now) > 600 {
		return nil, errors.New("lti: iat out of range")
	}
	if claims.ExpiresAt != nil && now > claims.ExpiresAt.Unix()+60 {
		return nil, errors.New("lti: token expired")
	}
	return claims, nil
}

func claimStringsMatch(aud jwt.ClaimStrings, expect string) bool {
	for _, a := range aud {
		if a == expect {
			return true
		}
	}
	return false
}

func audienceContains(aud any, expect string) bool {
	switch v := aud.(type) {
	case string:
		return v == expect
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok && s == expect {
				return true
			}
		}
		return false
	case []string:
		for _, s := range v {
			if s == expect {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// DecodeJWTPayloadJSON returns raw JSON of JWT payload (second segment) for NRPS.
func DecodeJWTPayloadJSON(token string) (map[string]any, error) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil, errors.New("jwt: malformed")
	}
	b, err := b64urlJWT(parts[1])
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// VerifyLtiBearerToken validates an RS256 JWT from a platform (NRPS) with issuer + signature only (Rust sets validate_aud = false).
func VerifyLtiBearerToken(token string, pub *rsa.PublicKey, expectISS string) (map[string]any, error) {
	if pub == nil {
		return nil, errors.New("lti: nil public key")
	}
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodRS256 {
			return nil, fmt.Errorf("unexpected method %v", t.Method)
		}
		return pub, nil
	}, jwt.WithoutClaimsValidation()) // we validate iss/exp manually; aud may be array
	if err != nil {
		return nil, err
	}
	iss, _ := claims["iss"].(string)
	if iss != expectISS {
		return nil, errors.New("lti: iss mismatch")
	}
	now := float64(time.Now().UTC().Unix())
	if exp, ok := claims["exp"].(float64); ok && now > exp+60 {
		return nil, errors.New("lti: token expired")
	}
	return claims, nil
}

// VerifyToolBearerTokenForAGS validates an access token from an external tool (inbound AGS).
func VerifyToolBearerTokenForAGS(token string, pub *rsa.PublicKey, expectISS, expectAud string) (map[string]any, error) {
	if pub == nil {
		return nil, errors.New("lti: nil public key")
	}
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodRS256 {
			return nil, fmt.Errorf("unexpected method %v", t.Method)
		}
		return pub, nil
	}, jwt.WithoutClaimsValidation())
	if err != nil {
		return nil, err
	}
	iss, _ := claims["iss"].(string)
	if iss != expectISS {
		return nil, errors.New("lti: iss mismatch")
	}
	if audienceContains(claims["aud"], expectAud) {
	} else {
		if cid, _ := claims["client_id"].(string); cid != expectAud {
			return nil, errors.New("lti: aud mismatch")
		}
	}
	now := float64(time.Now().UTC().Unix())
	if exp, ok := claims["exp"].(float64); ok && now > exp+60 {
		return nil, errors.New("lti: token expired")
	}
	return claims, nil
}

func b64urlJWT(seg string) ([]byte, error) {
	// allow missing padding
	s := seg
	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
	}
	return base64.URLEncoding.DecodeString(s)
}
