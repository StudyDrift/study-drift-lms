package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

const validTestJWT = "01234567890123456789012345678901"

var configEnvKeys = []string{
	"ALLOW_INSECURE_JWT",
	"ANNOTATION_ENABLED",
	"BLIND_GRADING_ENABLED",
	"CANVAS_ALLOWED_HOST_SUFFIXES",
	"COURSE_FILES_ROOT",
	"DATABASE_URL",
	"FEEDBACK_MEDIA_ENABLED",
	"GRADEBOOK_CSV_ENABLED",
	"GRADE_POSTING_POLICIES_ENABLED",
	"JWT_SECRET",
	"LTI_API_BASE_URL",
	"LTI_ENABLED",
	"LTI_RSA_KEY_ID",
	"LTI_RSA_PRIVATE_KEY_PEM",
	"MODERATED_GRADING_ENABLED",
	"OIDC_APPLE_CLIENT_ID",
	"OIDC_APPLE_KEY_ID",
	"OIDC_APPLE_PRIVATE_KEY_PATH",
	"OIDC_APPLE_PRIVATE_KEY_PEM",
	"OIDC_APPLE_TEAM_ID",
	"OIDC_GOOGLE_CLIENT_ID",
	"OIDC_GOOGLE_CLIENT_SECRET",
	"OIDC_GOOGLE_HD",
	"OIDC_GOOGLE_HOSTED_DOMAIN",
	"OIDC_MICROSOFT_CLIENT_ID",
	"OIDC_MICROSOFT_CLIENT_SECRET",
	"OIDC_MICROSOFT_TENANT",
	"OIDC_PUBLIC_BASE_URL",
	"OIDC_SSO_ENABLED",
	"OPEN_ROUTER_API_KEY",
	"OPENROUTER_API_KEY",
	"ORIGINALITY_DETECTION_ENABLED",
	"ORIGINALITY_STUB_EXTERNAL",
	"PORT",
	"PUBLIC_WEB_ORIGIN",
	"RESUBMISSION_WORKFLOW_ENABLED",
	"RUN_MIGRATIONS",
	"SAML_PUBLIC_BASE_URL",
	"SAML_SP_ENTITY_ID",
	"SAML_SP_PRIVATE_KEY_PATH",
	"SAML_SP_PRIVATE_KEY_PEM",
	"SAML_SP_X509_PATH",
	"SAML_SP_X509_PEM",
	"SAML_SSO_ENABLED",
	"SMTP_FROM",
	"SMTP_HOST",
	"SMTP_PASSWORD",
	"SMTP_PORT",
	"SMTP_USER",
}

func cleanEnv(t *testing.T) {
	t.Helper()
	for _, key := range configEnvKeys {
		t.Setenv(key, "")
	}
}

func baseEnv(t *testing.T) {
	t.Helper()
	cleanEnv(t)
	t.Setenv("DATABASE_URL", "postgres://a:b@localhost:5432/db")
	t.Setenv("JWT_SECRET", validTestJWT)
}

func TestLoadDefaults(t *testing.T) {
	baseEnv(t)
	c := Load()

	if !c.RunMigrations {
		t.Fatalf("RunMigrations: got false, want true when unset")
	}
	if c.HTTPAddr != ":8080" {
		t.Fatalf("HTTPAddr: %q", c.HTTPAddr)
	}
	if c.CourseFilesRoot != "data/course-files" {
		t.Fatalf("CourseFilesRoot: %q", c.CourseFilesRoot)
	}
	if c.PublicWebOrigin != "http://localhost:5173" {
		t.Fatalf("PublicWebOrigin: %q", c.PublicWebOrigin)
	}
	if !reflect.DeepEqual(c.CanvasAllowedHostSuffixes, []string{"instructure.com"}) {
		t.Fatalf("CanvasAllowedHostSuffixes: %#v", c.CanvasAllowedHostSuffixes)
	}
	if c.SMTPPort != 587 {
		t.Fatalf("SMTPPort: %d", c.SMTPPort)
	}
	if c.LTIAPIBaseURL != "http://localhost:8080" || c.LTIRSAKeyID != "lti-key-1" {
		t.Fatalf("LTI defaults: base=%q kid=%q", c.LTIAPIBaseURL, c.LTIRSAKeyID)
	}
	if !c.BlindGradingEnabled || !c.GradePostingPoliciesEnabled {
		t.Fatalf("default-on flags: blind=%v gradePosting=%v", c.BlindGradingEnabled, c.GradePostingPoliciesEnabled)
	}
	if c.SAMLPublicBaseURL != "http://localhost:8080" {
		t.Fatalf("SAMLPublicBaseURL: %q", c.SAMLPublicBaseURL)
	}
	if c.SAMLSPEntityID != "http://localhost:8080/auth/saml/metadata" {
		t.Fatalf("SAMLSPEntityID: %q", c.SAMLSPEntityID)
	}
	if c.OIDCPublicBaseURL != "http://localhost:8080" || c.OIDCMicrosoftTenant != "common" {
		t.Fatalf("OIDC defaults: base=%q tenant=%q", c.OIDCPublicBaseURL, c.OIDCMicrosoftTenant)
	}
}

func TestRunMigrationsFalse(t *testing.T) {
	baseEnv(t)
	t.Setenv("RUN_MIGRATIONS", "false")
	c := Load()
	if c.RunMigrations {
		t.Fatalf("RunMigrations: want false")
	}
	t.Setenv("RUN_MIGRATIONS", "1")
	if !Load().RunMigrations {
		t.Fatalf("RunMigrations: want true for 1")
	}
}

func TestHTTPAddr(t *testing.T) {
	baseEnv(t)
	t.Setenv("PORT", "3000")
	c := Load()
	if c.HTTPAddr != ":3000" {
		t.Fatalf("HTTPAddr: %q", c.HTTPAddr)
	}
	t.Setenv("PORT", "0")
	if a := httpAddrFromEnv(); a != ":0" {
		t.Fatalf("port 0: %q", a)
	}
	t.Setenv("PORT", ":9999")
	if a := httpAddrFromEnv(); a != ":9999" {
		t.Fatalf("direct :port: %q", a)
	}
}

// helper uses current env and is isolated by caller cleanup in TestHTTPAddr.
func httpAddrFromEnv() string { return httpAddr() }

func TestValidate(t *testing.T) {
	cleanEnv(t)
	c := Load()
	if c.Validate() == nil {
		t.Fatalf("expected error for empty DATABASE_URL")
	}
	c.DatabaseURL = "http://nope"
	if c.Validate() == nil {
		t.Fatalf("expected error for non-postgres URL")
	}
	c.DatabaseURL = "postgres://a:b@localhost:5432/db"
	c.JWTSecret = ""
	if c.Validate() == nil {
		t.Fatalf("expected error for empty JWT_SECRET")
	}
	c.JWTSecret = "short"
	if c.Validate() == nil {
		t.Fatalf("expected error for short JWT_SECRET")
	}
	c.JWTSecret = validTestJWT
	c.SAMLSSOEnabled = true
	c.SAMLSPX509PEM = ""
	if c.Validate() == nil {
		t.Fatalf("expected error for SAML without certificate")
	}
	c.SAMLSPX509PEM = "cert"
	if err := c.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
}

func TestJWTSecretAllowsInsecureFallback(t *testing.T) {
	cleanEnv(t)
	t.Setenv("DATABASE_URL", "postgres://a:b@localhost:5432/db")
	t.Setenv("ALLOW_INSECURE_JWT", "1")

	c := Load()
	if c.JWTSecret != insecureJWTFallback {
		t.Fatalf("JWTSecret: %q", c.JWTSecret)
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
}

func TestLoadTrimsAndUsesLegacyAliases(t *testing.T) {
	baseEnv(t)
	t.Setenv("OPEN_ROUTER_API_KEY", " api-key ")
	t.Setenv("COURSE_FILES_ROOT", " /tmp/course-files ")
	t.Setenv("CANVAS_ALLOWED_HOST_SUFFIXES", " *.Instructure.com, .canvas.example.edu, ")
	t.Setenv("PUBLIC_WEB_ORIGIN", " https://app.example.edu/ ")
	t.Setenv("SMTP_HOST", " smtp.example.edu ")
	t.Setenv("SMTP_PORT", "2525")
	t.Setenv("SMTP_USER", " user ")
	t.Setenv("SMTP_PASSWORD", " pass ")
	t.Setenv("SMTP_FROM", " no-reply@example.edu ")

	c := Load()
	if c.OpenRouterAPIKey != "api-key" {
		t.Fatalf("OpenRouterAPIKey: %q", c.OpenRouterAPIKey)
	}
	if c.CourseFilesRoot != "/tmp/course-files" {
		t.Fatalf("CourseFilesRoot: %q", c.CourseFilesRoot)
	}
	wantSuffixes := []string{"instructure.com", "canvas.example.edu"}
	if !reflect.DeepEqual(c.CanvasAllowedHostSuffixes, wantSuffixes) {
		t.Fatalf("CanvasAllowedHostSuffixes: got %#v want %#v", c.CanvasAllowedHostSuffixes, wantSuffixes)
	}
	if c.PublicWebOrigin != "https://app.example.edu" {
		t.Fatalf("PublicWebOrigin: %q", c.PublicWebOrigin)
	}
	if c.SMTPHost != "smtp.example.edu" || c.SMTPPort != 2525 || c.SMTPUser != "user" || c.SMTPPassword != "pass" || c.SMTPFrom != "no-reply@example.edu" {
		t.Fatalf("SMTP values not loaded as expected: %#v", c)
	}
}

func TestLoadIntegrationsAndFeatureFlags(t *testing.T) {
	baseEnv(t)
	t.Setenv("LTI_ENABLED", "true")
	t.Setenv("LTI_API_BASE_URL", " https://api.example.edu/ ")
	t.Setenv("LTI_RSA_PRIVATE_KEY_PEM", " key ")
	t.Setenv("LTI_RSA_KEY_ID", " kid ")
	t.Setenv("ANNOTATION_ENABLED", "on")
	t.Setenv("FEEDBACK_MEDIA_ENABLED", "yes")
	t.Setenv("BLIND_GRADING_ENABLED", "0")
	t.Setenv("MODERATED_GRADING_ENABLED", "1")
	t.Setenv("ORIGINALITY_DETECTION_ENABLED", "true")
	t.Setenv("ORIGINALITY_STUB_EXTERNAL", "true")
	t.Setenv("GRADE_POSTING_POLICIES_ENABLED", "off")
	t.Setenv("GRADEBOOK_CSV_ENABLED", "true")
	t.Setenv("RESUBMISSION_WORKFLOW_ENABLED", "true")
	t.Setenv("SAML_SSO_ENABLED", "true")
	t.Setenv("SAML_SP_X509_PEM", " cert ")
	t.Setenv("SAML_SP_PRIVATE_KEY_PEM", " saml-key ")
	t.Setenv("OIDC_SSO_ENABLED", "true")
	t.Setenv("OIDC_GOOGLE_CLIENT_ID", " google-id ")
	t.Setenv("OIDC_GOOGLE_CLIENT_SECRET", " google-secret ")
	t.Setenv("OIDC_GOOGLE_HD", " example.edu ")
	t.Setenv("OIDC_MICROSOFT_TENANT", " tenant ")
	t.Setenv("OIDC_MICROSOFT_CLIENT_ID", " ms-id ")
	t.Setenv("OIDC_MICROSOFT_CLIENT_SECRET", " ms-secret ")
	t.Setenv("OIDC_APPLE_CLIENT_ID", " apple-id ")
	t.Setenv("OIDC_APPLE_TEAM_ID", " team ")
	t.Setenv("OIDC_APPLE_KEY_ID", " apple-kid ")
	t.Setenv("OIDC_APPLE_PRIVATE_KEY_PEM", " apple-key ")

	c := Load()
	if !c.LTIEnabled || c.LTIAPIBaseURL != "https://api.example.edu" || c.LTIRSAPrivateKeyPEM != "key" || c.LTIRSAKeyID != "kid" {
		t.Fatalf("LTI values not loaded as expected: %#v", c)
	}
	if !c.AnnotationEnabled || !c.FeedbackMediaEnabled || c.BlindGradingEnabled || !c.ModeratedGradingEnabled ||
		!c.OriginalityDetectionEnabled || !c.OriginalityStubExternal || c.GradePostingPoliciesEnabled ||
		!c.GradebookCSVEnabled || !c.ResubmissionWorkflowEnabled {
		t.Fatalf("feature flags not loaded as expected: %#v", c)
	}
	if !c.SAMLSSOEnabled || c.SAMLPublicBaseURL != "https://api.example.edu" || c.SAMLSPEntityID != "https://api.example.edu/auth/saml/metadata" ||
		c.SAMLSPX509PEM != "cert" || c.SAMLSPPrivateKeyPEM != "saml-key" {
		t.Fatalf("SAML values not loaded as expected: %#v", c)
	}
	if !c.OIDCSSOEnabled || c.OIDCPublicBaseURL != "https://api.example.edu" || c.OIDCGoogleClientID != "google-id" ||
		c.OIDCGoogleClientSecret != "google-secret" || c.OIDCGoogleHostedDomain != "example.edu" ||
		c.OIDCMicrosoftTenant != "tenant" || c.OIDCMicrosoftClientID != "ms-id" || c.OIDCMicrosoftClientSecret != "ms-secret" ||
		c.OIDCAppleClientID != "apple-id" || c.OIDCAppleTeamID != "team" || c.OIDCAppleKeyID != "apple-kid" || c.OIDCApplePrivateKeyPEM != "apple-key" {
		t.Fatalf("OIDC values not loaded as expected: %#v", c)
	}
}

func TestLoadPEMValuesFromFiles(t *testing.T) {
	baseEnv(t)
	dir := t.TempDir()
	samlCertPath := filepath.Join(dir, "saml.crt")
	samlKeyPath := filepath.Join(dir, "saml.key")
	appleKeyPath := filepath.Join(dir, "apple.p8")
	mustWriteFile(t, samlCertPath, " cert-from-file \n")
	mustWriteFile(t, samlKeyPath, " saml-key-from-file \n")
	mustWriteFile(t, appleKeyPath, " apple-key-from-file \n")
	t.Setenv("SAML_SP_X509_PATH", samlCertPath)
	t.Setenv("SAML_SP_PRIVATE_KEY_PATH", samlKeyPath)
	t.Setenv("OIDC_APPLE_PRIVATE_KEY_PATH", appleKeyPath)

	c := Load()
	if c.SAMLSPX509PEM != "cert-from-file" || c.SAMLSPPrivateKeyPEM != "saml-key-from-file" || c.OIDCApplePrivateKeyPEM != "apple-key-from-file" {
		t.Fatalf("file-backed PEM values not loaded as expected: %#v", c)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("WriteFile(%q): %v", path, err)
	}
}

func TestOIDCProviderConfiguredHelpers(t *testing.T) {
	if (Config{OIDCGoogleClientID: "a", OIDCGoogleClientSecret: "b"}).OIDCGoogleConfigured() != true {
		t.Fatal("expected google true")
	}
	if (Config{OIDCGoogleClientID: "a"}).OIDCGoogleConfigured() != false {
		t.Fatal("expected google false without secret")
	}
	if (Config{OIDCMicrosoftClientID: "a", OIDCMicrosoftClientSecret: "b"}).OIDCMicrosoftConfigured() != true {
		t.Fatal("expected microsoft true")
	}
	if (Config{
		OIDCAppleClientID: "a", OIDCAppleTeamID: "b", OIDCAppleKeyID: "c", OIDCApplePrivateKeyPEM: "d",
	}).OIDCAppleConfigured() != true {
		t.Fatal("expected apple true")
	}
	if (Config{OIDCAppleClientID: "a"}).OIDCAppleConfigured() != false {
		t.Fatal("expected apple false")
	}
}
