package appsecrets

import (
	"bytes"
	"testing"
)

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	plain := []byte("smtp-secret-unicode-π")
	blob, err := Encrypt(plain, key)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decrypt(blob, key)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatalf("got %q want %q", got, plain)
	}
}

func TestDecrypt_WrongKey(t *testing.T) {
	k1 := bytes.Repeat([]byte{1}, 32)
	k2 := bytes.Repeat([]byte{2}, 32)
	blob, err := Encrypt([]byte("x"), k1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Decrypt(blob, k2); err == nil {
		t.Fatal("expected error")
	}
}

func TestDecrypt_Truncated(t *testing.T) {
	key := bytes.Repeat([]byte{3}, 32)
	if _, err := Decrypt([]byte{1}, key); err == nil {
		t.Fatal("expected error")
	}
}
