package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func base() envmap {
	return envmap{
		"DATABASE_URL": "postgres://a:b@h/d",
		"JWT_SECRET":  "12345678901234567890123456789012",
	}
}

func TestLoad_Exhaustive_OptionalEnv(t *testing.T) {
	pem := "/-----BEGIN-----\nabc\n-----END-----\n/"
	m := base()
	m["COURSE_FILES_ROOT"] = " /tmp/cf "
	m["PUBLIC_WEB_ORIGIN"] = "https://app.example.com/"
	m["OPENROUTER_API_KEY"] = "k"
	m["SMTP_HOST"] = "mx"
	m["SMTP_PORT"] = "2525"
	m["SMTP_USER"] = "u"
	m["SMTP_PASSWORD"] = "p"
	m["SMTP_FROM"] = "x@y.z"
	m["LTI_ENABLED"] = "1"
	m["LTI_API_BASE_URL"] = "https://api.example"
	m["LTI_RSA_PRIVATE_KEY_PEM"] = pem
	m["LTI_RSA_KEY_ID"] = "kid-9"
	m["ANNOTATION_ENABLED"] = "1"
	m["FEEDBACK_MEDIA_ENABLED"] = "1"
	m["BLIND_GRADING_ENABLED"] = "0"
	m["MODERATED_GRADING_ENABLED"] = "1"
	m["ORIGINALITY_DETECTION_ENABLED"] = "1"
	m["ORIGINALITY_STUB_EXTERNAL"] = "1"
	m["GRADE_POSTING_POLICIES_ENABLED"] = "0"
	m["GRADEBOOK_CSV_ENABLED"] = "1"
	m["RESUBMISSION_WORKFLOW_ENABLED"] = "1"
	c, err := LoadWithEnv(m.lookup)
	require.NoError(t, err)
	assert.Equal(t, "/tmp/cf", c.CourseFilesRoot)
	assert.Equal(t, "https://app.example.com", c.PublicWebOrigin)
	require.NotNil(t, c.OpenRouterAPIKey)
	assert.Equal(t, "mx", *c.SMTPHost)
	assert.Equal(t, 2525, c.SMTPPort)
	assert.True(t, c.LtiEnabled)
	assert.Equal(t, "https://api.example", c.LtiAPIBaseURL)
	assert.False(t, c.BlindGradingEnabled)
	assert.True(t, c.GradebookCSVEnabled)
}

func TestLoad_SAML_PrivateKeyAndPaths(t *testing.T) {
	m := base()
	m["SAML_SSO_ENABLED"] = "1"
	m["SAML_SP_X509_PEM"] = "PEM1"
	m["SAML_SP_PRIVATE_KEY_PEM"] = "PRIV"
	c, err := LoadWithEnv(m.lookup)
	require.NoError(t, err)
	require.Equal(t, "PRIV", *c.SAMLSpPrivateKeyPem)
}

func TestLoad_OIDC_FullSet(t *testing.T) {
	m := base()
	m["OIDC_SSO_ENABLED"] = "1"
	m["OIDC_PUBLIC_BASE_URL"] = "https://oidc.example"
	m["OIDC_GOOGLE_CLIENT_ID"] = "g1"
	m["OIDC_GOOGLE_CLIENT_SECRET"] = "g2"
	m["OIDC_GOOGLE_HOSTED_DOMAIN"] = "x.edu"
	m["OIDC_MICROSOFT_TENANT"] = "t1"
	m["OIDC_MICROSOFT_CLIENT_ID"] = "m1"
	m["OIDC_MICROSOFT_CLIENT_SECRET"] = "m2"
	m["OIDC_APPLE_CLIENT_ID"] = "a1"
	m["OIDC_APPLE_TEAM_ID"] = "a2"
	m["OIDC_APPLE_KEY_ID"] = "a3"
	m["OIDC_APPLE_PRIVATE_KEY_PEM"] = "a4"
	c, err := LoadWithEnv(m.lookup)
	require.NoError(t, err)
	assert.Equal(t, "g1", *c.OIDCGoogleClientID)
	assert.Equal(t, "x.edu", *c.OIDCGoogleHD)
	assert.Equal(t, "t1", c.OIDCMicrosoftTenant)
	assert.Equal(t, "a4", *c.OIDCApplePrivateKeyPem)
}

func TestLoad_SAML_PublicFromLTI(t *testing.T) {
	m := base()
	m["LTI_API_BASE_URL"] = "https://lti.example"
	m["SAML_SSO_ENABLED"] = "1"
	m["SAML_SP_X509_PEM"] = "CERTX"
	c, err := LoadWithEnv(m.lookup)
	require.NoError(t, err)
	assert.Equal(t, "https://lti.example", c.SAMLPublicBaseURL)
}

func TestLoad_SAML_SP_EntityDefault(t *testing.T) {
	m := base()
	m["SAML_SSO_ENABLED"] = "1"
	m["SAML_SP_X509_PEM"] = "CERTX"
	c, err := LoadWithEnv(m.lookup)
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:8080/auth/saml/metadata", c.SAMLSpEntityID)
}

func TestResolveJWT_EmptyRejects(t *testing.T) {
	_, err := LoadWithEnv(func(k string) (string, bool) {
		if k == "DATABASE_URL" {
			return "x", true
		}
		if k == "JWT_SECRET" {
			return "  ", true
		}
		return "", false
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errJWTEmpty)
}

func TestFileFromPath_LTIStyle(t *testing.T) {
	d := t.TempDir()
	pem := filepath.Join(d, "a.pem")
	require.NoError(t, os.WriteFile(pem, []byte("-----BEGIN-----\n"), 0o600))
	m := base()
	m["SAML_SSO_ENABLED"] = "1"
	m["SAML_SP_X509_PATH"] = pem
	c, err := LoadWithEnv(m.lookup)
	require.NoError(t, err)
	require.NotNil(t, c.SAMLSpX509Pem)
	assert.Contains(t, *c.SAMLSpX509Pem, "BEGIN")
}

func TestRunMigrations_EmptyEnvStaysTrue(t *testing.T) {
	m := base()
	m["RUN_MIGRATIONS"] = "   "
	c, err := LoadWithEnv(m.lookup)
	require.NoError(t, err)
	assert.True(t, c.RunMigrations)
}

func TestGetTrim_None(t *testing.T) {
	assert.Nil(t, getTrim(func(k string) (string, bool) { return "", false }, "A"))
}

func TestLoadWithEnv_SMTPPortValid(t *testing.T) {
	m := base()
	m["SMTP_PORT"] = "10025"
	c, err := LoadWithEnv(m.lookup)
	require.NoError(t, err)
	assert.Equal(t, 10025, c.SMTPPort)
}
