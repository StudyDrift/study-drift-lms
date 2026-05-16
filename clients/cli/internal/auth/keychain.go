package auth

import (
	"encoding/json"

	"github.com/zalando/go-keyring"
)

const keychainService = "lextures"

type keychainStore struct{}

// probe checks whether the OS keychain is reachable without side effects.
func (k *keychainStore) probe() error {
	_, err := keyring.Get(keychainService, "__probe__")
	if err == keyring.ErrNotFound {
		return nil
	}
	return err
}

func (k *keychainStore) Load(profile string) (*TokenData, error) {
	raw, err := keyring.Get(keychainService, profile)
	if err == keyring.ErrNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var t TokenData
	if err := json.Unmarshal([]byte(raw), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

func (k *keychainStore) Save(profile string, token *TokenData) error {
	raw, err := json.Marshal(token)
	if err != nil {
		return err
	}
	return keyring.Set(keychainService, profile, string(raw))
}

func (k *keychainStore) Delete(profile string) error {
	err := keyring.Delete(keychainService, profile)
	if err == keyring.ErrNotFound {
		return nil
	}
	return err
}

func (k *keychainStore) Backend() string { return "keychain" }
