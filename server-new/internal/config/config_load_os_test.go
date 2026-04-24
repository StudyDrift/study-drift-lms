package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const validJWT = "01234567890123456789012345678901"

// Exercises [Load] and the real environment lookup, plus [LoadDotenv] when a tree looks like a repo.
func TestLoad_DotenvAndOS(t *testing.T) {
	root := t.TempDir()
	// Mirror repo layout: server/.env
	srv := filepath.Join(root, "server")
	require.NoError(t, os.MkdirAll(srv, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(srv, ".env"), []byte("DUMMY_DOTENV=1\n"), 0o600))
	prev, err := os.Getwd()
	require.NoError(t, err)
	require.NoError(t, os.Chdir(root))
	t.Cleanup(func() {
		_ = os.Chdir(prev)
		_ = os.Unsetenv("DUMMY_DOTENV")
		_ = os.Unsetenv("DATABASE_URL")
		_ = os.Unsetenv("JWT_SECRET")
		_ = os.Unsetenv("FROB_FROM_ENV")
	})

	t.Setenv("FROB_FROM_ENV", "x")
	LoadDotenv() // may load DUMMY_DOTENV=1; ignore if godotenv fails silently on empty lines

	// [Load] requires DATABASE_URL and JWT
	t.Setenv("DATABASE_URL", "postgres://u:pass@localhost:5432/app")
	t.Setenv("JWT_SECRET", validJWT)
	t.Setenv("SMTP_PORT", "notanumber")
	c, err := Load()
	require.NoError(t, err)
	// bad SMTP_PORT: parseFloat fails, keeps default 587
	assert.Equal(t, 587, c.SMTPPort)
	assert.Equal(t, "postgres://u:pass@localhost:5432/app", c.DatabaseURL)
}

func TestLoad_JWTFromEnv_WhitespaceSecretRejected(t *testing.T) {
	t.Cleanup(clearTestEnv)
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "   \t  ")
	_, err := Load()
	require.Error(t, err)
	assert.ErrorIs(t, err, errJWTEmpty)
}

func clearTestEnv() {
	for _, k := range []string{"DATABASE_URL", "JWT_SECRET", "ALLOW_INSECURE_JWT", "SMTP_PORT", "FROB_FROM_ENV", "DUMMY_DOTENV", "COURSE_FILES_ROOT", "LTI_API_BASE_URL"} {
		_ = os.Unsetenv(k)
	}
}
