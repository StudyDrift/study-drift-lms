package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Manager coordinates token loading, saving, deletion, and silent refresh.
type Manager struct {
	store   Store
	baseURL string
}

// New returns a Manager backed by the best available store.
func New(baseURL string) *Manager {
	return &Manager{store: NewStore(), baseURL: baseURL}
}

// NewWithStore injects a custom store — intended for tests.
func NewWithStore(store Store, baseURL string) *Manager {
	return &Manager{store: store, baseURL: baseURL}
}

// Load retrieves the token for profile, refreshing it silently when expired.
// Returns nil, nil if no token is stored for the profile.
func (m *Manager) Load(profile string) (*TokenData, error) {
	tok, err := m.store.Load(profile)
	if err != nil || tok == nil {
		return tok, err
	}
	if !tok.IsExpired() {
		return tok, nil
	}
	if tok.RefreshToken == "" {
		return nil, nil
	}
	refreshed, err := m.doRefresh(tok.RefreshToken)
	if err != nil {
		// One retry on transient failure.
		refreshed, err = m.doRefresh(tok.RefreshToken)
		if err != nil {
			return nil, fmt.Errorf("token refresh failed: %w", err)
		}
	}
	if err := m.store.Save(profile, refreshed); err != nil {
		return nil, fmt.Errorf("saving refreshed token: %w", err)
	}
	return refreshed, nil
}

// Save persists token for profile.
func (m *Manager) Save(profile string, token *TokenData) error {
	return m.store.Save(profile, token)
}

// Delete removes the token for profile.
func (m *Manager) Delete(profile string) error {
	return m.store.Delete(profile)
}

// Backend returns the storage backend name.
func (m *Manager) Backend() string {
	return m.store.Backend()
}

type refreshResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func (m *Manager) doRefresh(refreshToken string) (*TokenData, error) {
	body, _ := json.Marshal(map[string]string{"refresh_token": refreshToken})
	resp, err := http.Post(m.baseURL+"/api/oauth/token/refresh", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("refresh returned HTTP %d", resp.StatusCode)
	}
	var r refreshResponse
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, fmt.Errorf("decoding refresh response: %w", err)
	}
	if r.AccessToken == "" {
		return nil, fmt.Errorf("refresh response missing access_token")
	}
	return &TokenData{
		AccessToken:  r.AccessToken,
		RefreshToken: refreshToken,
		Expiry:       time.Now().Add(time.Duration(r.ExpiresIn) * time.Second),
	}, nil
}
