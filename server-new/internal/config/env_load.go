package config

import (
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

// LoadDotenv loads the same key files the Rust app looks for: `server/.env` first, then
// `server-new/.env`, then `.env` in the working directory. Missing files are ignored.
// Already-set environment variables are not overwritten, matching the usual dotenv contract.
func LoadDotenv() {
	wd, err := os.Getwd()
	if err != nil {
		return
	}
	_ = tryLoad(filepath.Join(wd, "server", ".env"))
	_ = tryLoad(filepath.Join(wd, "server-new", ".env"))
	_ = tryLoad(filepath.Join(wd, ".env"))
}

func tryLoad(path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	return godotenv.Load(path)
}
