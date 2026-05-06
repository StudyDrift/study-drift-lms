package appsecrets

import (
	"bytes"
	"testing"
)

func TestEncryptDecrypt_BadKey(t *testing.T) {
	if _, err := Encrypt([]byte("x"), []byte("short")); err != ErrInvalidKey {
		t.Fatalf("encrypt bad key: %v", err)
	}
	if _, err := Decrypt(make([]byte, 30), []byte("short")); err != ErrInvalidKey {
		t.Fatalf("decrypt bad key: %v", err)
	}
}

func TestDecrypt_TooShort(t *testing.T) {
	key := make([]byte, 32)
	if _, err := Decrypt([]byte{1, 2, 3}, key); err != ErrDecrypt {
		t.Fatalf("got %v", err)
	}
}

func TestDecrypt_BadVersion(t *testing.T) {
	key := make([]byte, 32)
	blob := make([]byte, 1+12+16)
	blob[0] = 99
	if _, err := Decrypt(blob, key); err == nil {
		t.Fatal("expected unknown format")
	}
}

func TestEncryptDecrypt_RoundTrip2(t *testing.T) {
	key := bytes.Repeat([]byte("k"), 32)
	plain := []byte("hello world")
	ct, err := Encrypt(plain, key)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decrypt(ct, key)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatalf("got %q", got)
	}
}

func TestDecrypt_Tampered(t *testing.T) {
	key := bytes.Repeat([]byte("k"), 32)
	ct, _ := Encrypt([]byte("x"), key)
	ct[len(ct)-1] ^= 0xff
	if _, err := Decrypt(ct, key); err != ErrDecrypt {
		t.Fatalf("expected ErrDecrypt got %v", err)
	}
}
