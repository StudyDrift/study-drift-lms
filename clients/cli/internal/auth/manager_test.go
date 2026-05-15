package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/lextures/lextures/clients/cli/internal/auth"
)

// --- fakeStore ---

type fakeStore struct {
	tokens  map[string]*auth.TokenData
	backend string
}

func newFakeStore() *fakeStore {
	return &fakeStore{tokens: make(map[string]*auth.TokenData), backend: "fake"}
}

func (f *fakeStore) Load(profile string) (*auth.TokenData, error) {
	return f.tokens[profile], nil
}

func (f *fakeStore) Save(profile string, token *auth.TokenData) error {
	f.tokens[profile] = token
	return nil
}

func (f *fakeStore) Delete(profile string) error {
	delete(f.tokens, profile)
	return nil
}

func (f *fakeStore) Backend() string { return f.backend }

// --- TokenData tests ---

func TestTokenData_IsExpired_Zero(t *testing.T) {
	tok := auth.TokenData{}
	if tok.IsExpired() {
		t.Error("zero expiry should not be considered expired")
	}
}

func TestTokenData_IsExpired_Future(t *testing.T) {
	tok := auth.TokenData{Expiry: time.Now().Add(time.Hour)}
	if tok.IsExpired() {
		t.Error("future expiry should not be expired")
	}
}

func TestTokenData_IsExpired_Past(t *testing.T) {
	tok := auth.TokenData{Expiry: time.Now().Add(-time.Second)}
	if !tok.IsExpired() {
		t.Error("past expiry should be expired")
	}
}

// --- Manager tests ---

func TestManager_Load_NoToken(t *testing.T) {
	mgr := auth.NewWithStore(newFakeStore(), "http://example.com")
	tok, err := mgr.Load("default")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if tok != nil {
		t.Errorf("expected nil token for empty store, got %+v", tok)
	}
}

func TestManager_Load_ValidToken(t *testing.T) {
	store := newFakeStore()
	want := &auth.TokenData{
		AccessToken: "valid-token",
		Expiry:      time.Now().Add(time.Hour),
	}
	_ = store.Save("default", want)

	mgr := auth.NewWithStore(store, "http://example.com")
	got, err := mgr.Load("default")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got == nil || got.AccessToken != "valid-token" {
		t.Errorf("got %+v, want access_token=valid-token", got)
	}
}

func TestManager_Load_ExpiredNoRefreshToken(t *testing.T) {
	store := newFakeStore()
	_ = store.Save("default", &auth.TokenData{
		AccessToken: "old-token",
		Expiry:      time.Now().Add(-time.Hour),
	})

	mgr := auth.NewWithStore(store, "http://example.com")
	tok, err := mgr.Load("default")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if tok != nil {
		t.Errorf("expected nil when expired with no refresh token, got %+v", tok)
	}
}

func TestManager_Load_ExpiredWithRefreshToken(t *testing.T) {
	store := newFakeStore()
	_ = store.Save("default", &auth.TokenData{
		AccessToken:  "old-token",
		RefreshToken: "refresh-me",
		Expiry:       time.Now().Add(-time.Hour),
	})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/oauth/token/refresh" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["refresh_token"] != "refresh-me" {
			t.Errorf("refresh_token = %q, want refresh-me", body["refresh_token"])
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "new-token",
			"expires_in":   3600,
		})
	}))
	defer srv.Close()

	mgr := auth.NewWithStore(store, srv.URL)
	tok, err := mgr.Load("default")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if tok == nil || tok.AccessToken != "new-token" {
		t.Errorf("got %+v, want access_token=new-token", tok)
	}
	// Verify persisted in store.
	saved, _ := store.Load("default")
	if saved == nil || saved.AccessToken != "new-token" {
		t.Errorf("refreshed token not saved to store")
	}
}

func TestManager_Load_RefreshRetryOnFailure(t *testing.T) {
	store := newFakeStore()
	_ = store.Save("default", &auth.TokenData{
		AccessToken:  "old",
		RefreshToken: "retry-me",
		Expiry:       time.Now().Add(-time.Hour),
	})

	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "retry-success",
			"expires_in":   3600,
		})
	}))
	defer srv.Close()

	mgr := auth.NewWithStore(store, srv.URL)
	tok, err := mgr.Load("default")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if tok == nil || tok.AccessToken != "retry-success" {
		t.Errorf("got %+v, want retry-success", tok)
	}
	if calls != 2 {
		t.Errorf("expected 2 refresh calls (1 fail + 1 retry), got %d", calls)
	}
}

func TestManager_Save(t *testing.T) {
	store := newFakeStore()
	mgr := auth.NewWithStore(store, "http://example.com")

	want := &auth.TokenData{AccessToken: "tok", Expiry: time.Now().Add(time.Hour)}
	if err := mgr.Save("myprofile", want); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, _ := store.Load("myprofile")
	if got == nil || got.AccessToken != "tok" {
		t.Errorf("got %+v, want access_token=tok", got)
	}
}

func TestManager_Delete(t *testing.T) {
	store := newFakeStore()
	_ = store.Save("default", &auth.TokenData{AccessToken: "bye"})

	mgr := auth.NewWithStore(store, "http://example.com")
	if err := mgr.Delete("default"); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	got, _ := store.Load("default")
	if got != nil {
		t.Errorf("expected nil after Delete, got %+v", got)
	}
}

func TestManager_Backend(t *testing.T) {
	store := &fakeStore{backend: "keychain"}
	mgr := auth.NewWithStore(store, "http://example.com")
	if b := mgr.Backend(); b != "keychain" {
		t.Errorf("Backend = %q, want keychain", b)
	}
}
