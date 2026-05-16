package auth

import "os"

// Store abstracts token persistence across CLI invocations.
type Store interface {
	Load(profile string) (*TokenData, error)
	Save(profile string, token *TokenData) error
	Delete(profile string) error
	// Backend returns a human-readable name for the active storage mechanism.
	Backend() string
}

// NewStore returns the best available store: OS keychain when reachable,
// falling back to an encrypted file at ~/.lextures-token.
// Set LEXTURES_TOKEN_BACKEND=file to force file storage (useful in CI / tests).
func NewStore() Store {
	if os.Getenv("LEXTURES_TOKEN_BACKEND") == "file" {
		return newFileStore()
	}
	ks := &keychainStore{}
	if ks.probe() == nil {
		return ks
	}
	return newFileStore()
}
