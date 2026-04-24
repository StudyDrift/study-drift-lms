package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type envmap map[string]string

func TestLoadWithEnv_RequiresDatabaseURL(t *testing.T) {
	_, err := LoadWithEnv(func(string) (string, bool) { return "", false })
	assert.ErrorIs(t, err, errDatabase)
}

func TestLoadWithEnv_RequiresJWT(t *testing.T) {
	_, err := LoadWithEnv(func(k string) (string, bool) {
		if k == "DATABASE_URL" {
			return "postgres://localhost/x", true
		}
		return "", false
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errJWTMissing)
}

func TestLoadWithEnv_Ok(t *testing.T) {
	lookup := func(k string) (string, bool) {
		m := map[string]string{
			"DATABASE_URL":   "postgres://u:p@host:5432/db",
			"JWT_SECRET":     "12345678901234567890123456789012",
		}
		if v, ok := m[k]; ok {
			return v, true
		}
		return "", false
	}
	c, err := LoadWithEnv(lookup)
	require.NoError(t, err)
	assert.Equal(t, "12345678901234567890123456789012", c.JWTSecret)
	assert.True(t, c.RunMigrations)
	assert.Equal(t, "instructure.com", c.CanvasAllowedHostSuffixes[0])
	assert.Equal(t, "data/course-files", c.CourseFilesRoot)
	assert.Equal(t, "http://localhost:5173", c.PublicWebOrigin)
}

func TestLoadWithEnv_SAMLRequiresCert(t *testing.T) {
	lookup := func(k string) (string, bool) {
		m := map[string]string{
			"DATABASE_URL":    "postgres://u:p@host:5432/db",
			"JWT_SECRET":      "12345678901234567890123456789012",
			"SAML_SSO_ENABLED": "1",
		}
		if v, ok := m[k]; ok {
			return v, true
		}
		return "", false
	}
	_, err := LoadWithEnv(lookup)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "SAML_SP_X509_PEM")
}

func TestIsTruthy(t *testing.T) {
	lookup := func(k string) (string, bool) { return "true", true }
	assert.True(t, isTruthy(lookup, "K"))
	lookup2 := func(k string) (string, bool) { return "0", true }
	assert.False(t, isTruthy(lookup2, "K"))
}

func TestDefaultTrueFlag(t *testing.T) {
	unset := func(k string) (string, bool) { return "", false }
	assert.True(t, defaultTrueFlag(unset, "X"))
	off := func(k string) (string, bool) { return "0", true }
	assert.False(t, defaultTrueFlag(off, "X"))
	empty := func(k string) (string, bool) { return "  ", true }
	assert.True(t, defaultTrueFlag(empty, "X"))
	weird := func(k string) (string, bool) { return "maybe", true }
	assert.False(t, defaultTrueFlag(weird, "X"))
}

func TestIsFalsy(t *testing.T) {
	lookup := func(k string) (string, bool) { return "false", true }
	assert.True(t, isFalsy(lookup, "R"))
}

func (m envmap) lookup(k string) (string, bool) {
	v, ok := m[k]
	return v, ok
}

func TestLoadWithEnv_JWTInsecure(t *testing.T) {
	c, err := LoadWithEnv((envmap{
		"DATABASE_URL":    "postgres://h/db",
		"ALLOW_INSECURE_JWT": "1",
	}).lookup)
	require.NoError(t, err)
	assert.Equal(t, insecureJWTFallback, c.JWTSecret)
}

func TestLoadWithEnv_JWTTooShort(t *testing.T) {
	_, err := LoadWithEnv((envmap{
		"DATABASE_URL": "postgres://h/db",
		"JWT_SECRET":   "1234567890123456789012345678901",
	}).lookup)
	require.Error(t, err)
	assert.ErrorIs(t, err, errJWTShort)
}

func TestLoadWithEnv_CanvasCSVHosts(t *testing.T) {
	c, err := LoadWithEnv((envmap{
		"DATABASE_URL":                  "postgres://h/db",
		"JWT_SECRET":                    "12345678901234567890123456789012",
		"CANVAS_ALLOWED_HOST_SUFFIXES": "*.instructure.com,  .example.ORG  ",
	}).lookup)
	require.NoError(t, err)
	assert.Equal(t, []string{"instructure.com", "example.org"}, c.CanvasAllowedHostSuffixes)
}

func TestLoadWithEnv_SAMLWithCert(t *testing.T) {
	c, err := LoadWithEnv((envmap{
		"DATABASE_URL":     "postgres://h/db",
		"JWT_SECRET":      "12345678901234567890123456789012",
		"SAML_SSO_ENABLED": "1",
		"SAML_SP_X509_PEM": "-----BEGIN CERT-----\nMIIB\n-----END CERT-----",
	}).lookup)
	require.NoError(t, err)
	assert.True(t, c.SAMLSsoEnabled)
	require.NotNil(t, c.SAMLSpX509Pem)
}

func TestRunMigrationsToggle(t *testing.T) {
	c, err := LoadWithEnv(func(k string) (string, bool) {
		base := map[string]string{
			"DATABASE_URL": "postgres://u:p@h/db",
			"JWT_SECRET":   "12345678901234567890123456789012",
		}
		if k == "RUN_MIGRATIONS" {
			return "0", true
		}
		if v, ok := base[k]; ok {
			return v, true
		}
		return "", false
	})
	require.NoError(t, err)
	assert.False(t, c.RunMigrations)
}

func TestParseCSVHosts_Single(t *testing.T) {
	assert.Empty(t, parseCSVHosts(""))
}

func TestOpenRouterKeyAliases(t *testing.T) {
	c, err := LoadWithEnv(func(k string) (string, bool) {
		m := map[string]string{
			"DATABASE_URL":     "postgres://u:p@h/db",
			"JWT_SECRET":       "12345678901234567890123456789012",
			"OPEN_ROUTER_API_KEY": "abc",
		}
		if v, ok := m[k]; ok {
			return v, true
		}
		return "", false
	})
	require.NoError(t, err)
	require.NotNil(t, c.OpenRouterAPIKey)
	assert.Equal(t, "abc", *c.OpenRouterAPIKey)
}
