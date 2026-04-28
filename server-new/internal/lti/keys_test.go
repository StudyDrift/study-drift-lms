package lti

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"testing"
)

func TestFromPKCS8PEM_errors(t *testing.T) {
	if _, err := FromPKCS8PEM("not pem", "kid-1"); err == nil {
		t.Fatal("expected error for garbage pem")
	}
}

func TestJwkSHA256Thumbprint_base64urlLen(t *testing.T) {
	// 32 bytes → 43 char base64url (no padding)
	if got, want := len(jwkSHA256Thumbprint([]byte{1, 2, 3}, []byte{4, 5})), 43; got != want {
		t.Fatalf("thumbprint base64url len: got %d want %d", got, want)
	}
}

func TestJWKSJSON_fromGeneratedKey(t *testing.T) {
	pk, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(pk)
	if err != nil {
		t.Fatal(err)
	}
	pemData := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))

	k, err := FromPKCS8PEM(pemData, "test-kid-1")
	if err != nil {
		t.Fatalf("from generated PKCS8: %v", err)
	}
	b, err := k.JWKSBytes()
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Keys []struct {
			Kty    string `json:"kty"`
			Kid    string `json:"kid"`
			Use    string `json:"use"`
			Alg    string `json:"alg"`
			N      string `json:"n"`
			E      string `json:"e"`
			X5S256 string `json:"x5t#S256"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Keys) != 1 {
		t.Fatalf("keys: %+v", doc)
	}
	if doc.Keys[0].Kty != "RSA" || doc.Keys[0].Kid != "test-kid-1" {
		t.Fatalf("unexpected jwk: %+v", doc.Keys[0])
	}
	if len(doc.Keys[0].N) < 8 || len(doc.Keys[0].E) < 1 || len(doc.Keys[0].X5S256) != 43 {
		t.Fatalf("unexpected b64 parts: %+v", doc.Keys[0])
	}
}
