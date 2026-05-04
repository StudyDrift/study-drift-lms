// Package appsecrets encrypts short UTF-8 strings at rest (e.g. SMTP passwords) using AES-256-GCM.
package appsecrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
)

const (
	formatVersion byte = 1
	nonceSize     int  = 12 // GCM standard nonce
)

// ErrInvalidKey means the key is not usable for AES-256-GCM.
var ErrInvalidKey = errors.New("appsecrets: key must be exactly 32 bytes")

// ErrDecrypt means ciphertext is missing, corrupt, or was encrypted with a different key.
var ErrDecrypt = errors.New("appsecrets: decrypt failed")

// Encrypt appends version || nonce || ciphertext+tag suitable for BYTEA storage.
func Encrypt(plaintext []byte, key []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, ErrInvalidKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	out := make([]byte, 0, 1+len(nonce)+len(sealed))
	out = append(out, formatVersion)
	out = append(out, nonce...)
	out = append(out, sealed...)
	return out, nil
}

// Decrypt reverses Encrypt.
func Decrypt(blob []byte, key []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, ErrInvalidKey
	}
	if len(blob) < 1+nonceSize+16 { // version + nonce + min tag
		return nil, ErrDecrypt
	}
	if blob[0] != formatVersion {
		return nil, fmt.Errorf("%w: unknown format %d", ErrDecrypt, blob[0])
	}
	nonce := blob[1 : 1+nonceSize]
	ct := blob[1+nonceSize:]
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, ErrDecrypt
	}
	return plain, nil
}
