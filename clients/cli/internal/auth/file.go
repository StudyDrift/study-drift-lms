package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const tokenFileName = ".lextures-token"

type fileStore struct {
	path string
	mu   sync.Mutex
}

func newFileStore() *fileStore {
	home, _ := os.UserHomeDir()
	return &fileStore{path: filepath.Join(home, tokenFileName)}
}

// NewFileStoreAt returns a file-backed Store at the given path. Intended for tests.
func NewFileStoreAt(path string) Store {
	return &fileStore{path: path}
}

type tokenMap map[string]*TokenData

func (f *fileStore) read() (tokenMap, error) {
	data, err := os.ReadFile(f.path)
	if errors.Is(err, os.ErrNotExist) {
		return make(tokenMap), nil
	}
	if err != nil {
		return nil, err
	}
	var m tokenMap
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("corrupt token file %s: %w", f.path, err)
	}
	return m, nil
}

func (f *fileStore) write(m tokenMap) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return os.WriteFile(f.path, data, 0o600)
}

func (f *fileStore) warnIfPermissive() {
	info, err := os.Stat(f.path)
	if err != nil {
		return
	}
	if info.Mode().Perm()&0o177 != 0 {
		fmt.Fprintf(os.Stderr, "warning: token file %s has permissions %04o; recommend 0600\n",
			f.path, info.Mode().Perm())
	}
}

func (f *fileStore) Load(profile string) (*TokenData, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.warnIfPermissive()
	m, err := f.read()
	if err != nil {
		return nil, err
	}
	return m[profile], nil
}

func (f *fileStore) Save(profile string, token *TokenData) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, err := f.read()
	if err != nil {
		return err
	}
	m[profile] = token
	return f.write(m)
}

func (f *fileStore) Delete(profile string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, err := f.read()
	if err != nil {
		return err
	}
	delete(m, profile)
	return f.write(m)
}

func (f *fileStore) Backend() string { return "file" }
