package lti

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

const jwksFetchTimeout = 12 * time.Second
const jwksCacheTTL = 15 * time.Minute

type cachedJWKS struct {
	fetched time.Time
	byKid   map[string]*rsa.PublicKey
}

var jwksMem sync.Map // jwksURL string -> cachedJWKS

type jwksDoc struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kid *string `json:"kid"`
	Kty string  `json:"kty"`
	Use *string `json:"use"`
	N   *string `json:"n"`
	E   *string `json:"e"`
}

func b64url(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

func jwkRSAPublic(j *jwk) (*rsa.PublicKey, error) {
	if j.N == nil || j.E == nil {
		return nil, errors.New("jwks: missing n or e")
	}
	nb, err := b64url(*j.N)
	if err != nil {
		return nil, err
	}
	eb, err := b64url(*j.E)
	if err != nil {
		return nil, err
	}
	n := new(big.Int).SetBytes(nb)
	e := new(big.Int).SetBytes(eb).Int64()
	if e < 2 {
		return nil, errors.New("jwks: bad exponent")
	}
	return &rsa.PublicKey{N: n, E: int(e)}, nil
}

func parseJWKSKeys(body []byte) (map[string]*rsa.PublicKey, error) {
	var doc jwksDoc
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	out := make(map[string]*rsa.PublicKey)
	for i := range doc.Keys {
		j := &doc.Keys[i]
		if j.Kty != "RSA" {
			continue
		}
		if j.Use != nil && *j.Use != "sig" {
			continue
		}
		pub, err := jwkRSAPublic(j)
		if err != nil {
			continue
		}
		kid := "default"
		if j.Kid != nil && *j.Kid != "" {
			kid = *j.Kid
		}
		out[kid] = pub
	}
	if len(out) == 0 {
		return nil, errors.New("jwks: no RSA sig keys")
	}
	return out, nil
}

func fetchJWKSUncached(jwksURL string) (map[string]*rsa.PublicKey, error) {
	ctx, cancel := context.WithTimeout(context.Background(), jwksFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("jwks: http %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	return parseJWKSKeys(b)
}

// PublicKeyForJWT returns the RSA public key to verify token (RS256) using the IdP JWKS document.
func PublicKeyForJWT(jwksURL, token string) (*rsa.PublicKey, error) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil, errors.New("jwt: malformed")
	}
	hd, err := b64url(parts[0])
	if err != nil {
		return nil, err
	}
	var h2 struct {
		Kid string `json:"kid"`
	}
	_ = json.Unmarshal(hd, &h2)
	kid := h2.Kid
	if kid == "" {
		kid = "default"
	}
	// cache
	if v, ok := jwksMem.Load(jwksURL); ok {
		c := v.(cachedJWKS)
		if time.Since(c.fetched) < jwksCacheTTL {
			if k, ok := c.byKid[kid]; ok {
				return k, nil
			}
			if k, ok := c.byKid["default"]; ok {
				return k, nil
			}
		}
	}
	keys, err := fetchJWKSUncached(jwksURL)
	if err != nil {
		return nil, err
	}
	jwksMem.Store(jwksURL, cachedJWKS{fetched: time.Now(), byKid: keys})
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	if k, ok := keys["default"]; ok {
		return k, nil
	}
	return nil, errors.New("jwks: kid not found")
}
