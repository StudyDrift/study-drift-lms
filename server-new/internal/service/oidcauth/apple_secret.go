package oidcauth

import (
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/lextures/lextures/server-new/internal/config"
)

// AppleClientSecretJWT is the short-lived client secret for token exchange (ES256, Apple docs).
func AppleClientSecretJWT(c config.Config) (string, error) {
	pemS := c.OIDCApplePrivateKeyPEM
	if pemS == "" {
		return "", errors.New("OIDC: missing Apple private key")
	}
	block, _ := pem.Decode([]byte(pemS))
	if block == nil {
		return "", errors.New("OIDC: Apple private key is not valid PEM")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// try PKCS1 EC
		k, err = x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return "", fmt.Errorf("OIDC: parse Apple private key: %w", err)
		}
	}
	ec, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return "", errors.New("OIDC: Apple private key is not EC")
	}
	now := time.Now().UTC().Unix()
	claims := jwt.MapClaims{
		"iss": c.OIDCAppleTeamID,
		"iat": now,
		"exp": now + 600,
		"aud": "https://appleid.apple.com",
		"sub": c.OIDCAppleClientID,
	}
	t := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	t.Header["kid"] = c.OIDCAppleKeyID
	return t.SignedString(ec)
}
