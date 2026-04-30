package auth

import (
	"github.com/alexedwards/argon2id"
)

// rustArgon2idParams matches the Rust `argon2` 0.5 `Argon2::default()` (Argon2id) settings.
// PHC strings are compatible with the legacy server's password_hash column.
var rustArgon2idParams = &argon2id.Params{
	Memory:      19456,
	Iterations:  2,
	Parallelism: 1,
	SaltLength:  16,
	KeyLength:   32,
}

// HashPassword returns an Argon2id PHC string suitable for users.password_hash.
func HashPassword(plain string) (string, error) {
	return argon2id.CreateHash(plain, rustArgon2idParams)
}

// VerifyPassword checks plain against a stored Argon2id PHC hash.
func VerifyPassword(plain, stored string) (bool, error) {
	if stored == "" {
		return false, nil
	}
	return argon2id.ComparePasswordAndHash(plain, stored)
}
