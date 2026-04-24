// Package config mirrors the Rust server's environment variables and defaults
// (see `server/src/config.rs`).
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// JWTSecretMinLen matches the Rust `JWT_SECRET_MIN_LEN`.
const JWTSecretMinLen = 32

const insecureJWTFallback = "dev-secret-do-not-use-in-production"

// Config matches `server/src/config::Config` field semantics.
type Config struct {
	DatabaseURL   string
	JWTSecret     string
	RunMigrations bool

	OpenRouterAPIKey          *string
	CourseFilesRoot           string
	CanvasAllowedHostSuffixes []string
	PublicWebOrigin           string

	SMTPHost     *string
	SMTPPort     int
	SMTPUser     *string
	SMTPPassword *string
	SMTPFrom     *string

	LtiEnabled          bool
	LtiAPIBaseURL       string
	LtiRsaPrivateKeyPem *string
	LtiRsaKeyID         string

	AnnotationEnabled            bool
	FeedbackMediaEnabled         bool
	BlindGradingEnabled          bool
	ModeratedGradingEnabled      bool
	OriginalityDetectionEnabled  bool
	OriginalityStubExternal      bool
	GradePostingPoliciesEnabled  bool
	GradebookCSVEnabled          bool
	ResubmissionWorkflowEnabled  bool

	SAMLSsoEnabled      bool
	SAMLPublicBaseURL   string
	SAMLSpEntityID      string
	SAMLSpX509Pem       *string
	SAMLSpPrivateKeyPem *string

	OIDCSsoEnabled            bool
	OIDCPublicBaseURL         string
	OIDCGoogleClientID        *string
	OIDCGoogleClientSecret    *string
	OIDCGoogleHD              *string
	OIDCMicrosoftTenant       string
	OIDCMicrosoftClientID     *string
	OIDCMicrosoftClientSecret *string
	OIDCAppleClientID         *string
	OIDCAppleTeamID           *string
	OIDCAppleKeyID            *string
	OIDCApplePrivateKeyPem    *string
}

// Load reads the real process environment.
func Load() (*Config, error) { return LoadWithEnv(lookupOS) }

func lookupOS(k string) (string, bool) { return os.LookupEnv(k) }

// LoadWithEnv is used by tests; lookup should behave like [os.LookupEnv].
func LoadWithEnv(lookup func(string) (string, bool)) (*Config, error) {
	allowInsecure := isTruthy(lookup, "ALLOW_INSECURE_JWT")

	rawDB, ok := lookup("DATABASE_URL")
	if !ok {
		return nil, errDatabase
	}
	db := strings.TrimSpace(rawDB)
	if db == "" {
		return nil, errDatabase
	}

	jwt, err := resolveJWT(lookup, allowInsecure)
	if err != nil {
		return nil, err
	}

	runMig := true
	if v, ok := lookup("RUN_MIGRATIONS"); ok {
		if strings.TrimSpace(v) != "" {
			runMig = !isFalsy(lookup, "RUN_MIGRATIONS")
		}
	}

	c := &Config{
		DatabaseURL:   db,
		JWTSecret:     jwt,
		RunMigrations: runMig,

		CourseFilesRoot: firstNonEmpty(lookup, "COURSE_FILES_ROOT", "data/course-files"),
		PublicWebOrigin: strings.TrimRight(firstNonEmpty(lookup, "PUBLIC_WEB_ORIGIN", "http://localhost:5173"), "/"),
		SMTPPort:        587,
		LtiAPIBaseURL:   "http://localhost:8080",
		LtiRsaKeyID:     "lti-key-1",
		CanvasAllowedHostSuffixes: []string{"instructure.com"},
		BlindGradingEnabled:        true,
		GradePostingPoliciesEnabled: true,
	}

	c.CourseFilesRoot = strings.TrimSpace(c.CourseFilesRoot)

	// API keys
	if t := getTrim(lookup, "OPENROUTER_API_KEY"); t != nil {
		c.OpenRouterAPIKey = t
	} else if t2 := getTrim(lookup, "OPEN_ROUTER_API_KEY"); t2 != nil {
		c.OpenRouterAPIKey = t2
	}
	if t := getTrim(lookup, "SMTP_HOST"); t != nil {
		c.SMTPHost = t
	}
	if v, ok := lookup("SMTP_PORT"); ok {
		if p, err := parseUint16(strings.TrimSpace(v)); err == nil {
			c.SMTPPort = int(p)
		}
	}
	if t := getTrim(lookup, "SMTP_USER"); t != nil {
		c.SMTPUser = t
	}
	if t := getTrim(lookup, "SMTP_PASSWORD"); t != nil {
		c.SMTPPassword = t
	}
	if t := getTrim(lookup, "SMTP_FROM"); t != nil {
		c.SMTPFrom = t
	}
	if s, ok := lookup("CANVAS_ALLOWED_HOST_SUFFIXES"); ok {
		if suff := parseCSVHosts(s); len(suff) > 0 {
			c.CanvasAllowedHostSuffixes = suff
		}
	}

	// LTI
	c.LtiEnabled = isTruthy(lookup, "LTI_ENABLED")
	if u := getTrim(lookup, "LTI_API_BASE_URL"); u != nil {
		c.LtiAPIBaseURL = strings.TrimRight(*u, "/")
	} else {
		c.LtiAPIBaseURL = strings.TrimRight(c.LtiAPIBaseURL, "/")
	}
	if t := getTrim(lookup, "LTI_RSA_PRIVATE_KEY_PEM"); t != nil {
		c.LtiRsaPrivateKeyPem = t
	}
	if t := getTrim(lookup, "LTI_RSA_KEY_ID"); t != nil {
		c.LtiRsaKeyID = *t
	}

	c.AnnotationEnabled = isTruthy(lookup, "ANNOTATION_ENABLED")
	c.FeedbackMediaEnabled = isTruthy(lookup, "FEEDBACK_MEDIA_ENABLED")
	c.BlindGradingEnabled = defaultTrueFlag(lookup, "BLIND_GRADING_ENABLED")
	c.ModeratedGradingEnabled = isTruthy(lookup, "MODERATED_GRADING_ENABLED")
	c.OriginalityDetectionEnabled = isTruthy(lookup, "ORIGINALITY_DETECTION_ENABLED")
	c.OriginalityStubExternal = isTruthy(lookup, "ORIGINALITY_STUB_EXTERNAL")
	c.GradePostingPoliciesEnabled = defaultTrueFlag(lookup, "GRADE_POSTING_POLICIES_ENABLED")
	c.GradebookCSVEnabled = isTruthy(lookup, "GRADEBOOK_CSV_ENABLED")
	c.ResubmissionWorkflowEnabled = isTruthy(lookup, "RESUBMISSION_WORKFLOW_ENABLED")

	// SAML
	c.SAMLSsoEnabled = isTruthy(lookup, "SAML_SSO_ENABLED")
	if t := getTrim(lookup, "SAML_PUBLIC_BASE_URL"); t != nil {
		c.SAMLPublicBaseURL = strings.TrimRight(*t, "/")
	} else if t := getTrim(lookup, "LTI_API_BASE_URL"); t != nil {
		c.SAMLPublicBaseURL = strings.TrimRight(*t, "/")
	} else {
		c.SAMLPublicBaseURL = "http://localhost:8080"
	}
	if t := getTrim(lookup, "SAML_SP_ENTITY_ID"); t != nil {
		c.SAMLSpEntityID = *t
	} else {
		c.SAMLSpEntityID = fmt.Sprintf("%s/auth/saml/metadata", c.SAMLPublicBaseURL)
	}
	if t := getTrim(lookup, "SAML_SP_X509_PEM"); t != nil {
		c.SAMLSpX509Pem = t
	} else if s, ok := fileFromPath(lookup, "SAML_SP_X509_PATH"); ok {
		c.SAMLSpX509Pem = strPtr(s)
	}
	if t := getTrim(lookup, "SAML_SP_PRIVATE_KEY_PEM"); t != nil {
		c.SAMLSpPrivateKeyPem = t
	} else if s, ok := fileFromPath(lookup, "SAML_SP_PRIVATE_KEY_PATH"); ok {
		c.SAMLSpPrivateKeyPem = strPtr(s)
	}
	if c.SAMLSsoEnabled && c.SAMLSpX509Pem == nil {
		return nil, errors.New("SAML_SSO_ENABLED is set but SAML_SP_X509_PEM (or SAML_SP_X509_PATH) is missing")
	}

	// OIDC
	c.OIDCSsoEnabled = isTruthy(lookup, "OIDC_SSO_ENABLED")
	if t := getTrim(lookup, "OIDC_PUBLIC_BASE_URL"); t != nil {
		c.OIDCPublicBaseURL = strings.TrimRight(*t, "/")
	} else if t := getTrim(lookup, "LTI_API_BASE_URL"); t != nil {
		c.OIDCPublicBaseURL = strings.TrimRight(*t, "/")
	} else {
		c.OIDCPublicBaseURL = "http://localhost:8080"
	}
	if t := getTrim(lookup, "OIDC_GOOGLE_CLIENT_ID"); t != nil {
		c.OIDCGoogleClientID = t
	}
	if t := getTrim(lookup, "OIDC_GOOGLE_CLIENT_SECRET"); t != nil {
		c.OIDCGoogleClientSecret = t
	}
	if t := getTrim(lookup, "OIDC_GOOGLE_HOSTED_DOMAIN"); t != nil {
		c.OIDCGoogleHD = t
	} else if t := getTrim(lookup, "OIDC_GOOGLE_HD"); t != nil {
		c.OIDCGoogleHD = t
	}
	if t := getTrim(lookup, "OIDC_MICROSOFT_TENANT"); t != nil {
		c.OIDCMicrosoftTenant = *t
	} else {
		c.OIDCMicrosoftTenant = "common"
	}
	if t := getTrim(lookup, "OIDC_MICROSOFT_CLIENT_ID"); t != nil {
		c.OIDCMicrosoftClientID = t
	}
	if t := getTrim(lookup, "OIDC_MICROSOFT_CLIENT_SECRET"); t != nil {
		c.OIDCMicrosoftClientSecret = t
	}
	if t := getTrim(lookup, "OIDC_APPLE_CLIENT_ID"); t != nil {
		c.OIDCAppleClientID = t
	}
	if t := getTrim(lookup, "OIDC_APPLE_TEAM_ID"); t != nil {
		c.OIDCAppleTeamID = t
	}
	if t := getTrim(lookup, "OIDC_APPLE_KEY_ID"); t != nil {
		c.OIDCAppleKeyID = t
	}
	if t := getTrim(lookup, "OIDC_APPLE_PRIVATE_KEY_PEM"); t != nil {
		c.OIDCApplePrivateKeyPem = t
	} else if s, ok := fileFromPath(lookup, "OIDC_APPLE_PRIVATE_KEY_PATH"); ok {
		c.OIDCApplePrivateKeyPem = strPtr(s)
	}

	return c, nil
}

var errDatabase = errors.New("DATABASE_URL is not set")

func strPtr(s string) *string { return &s }

func resolveJWT(lookup func(string) (string, bool), allowInsecure bool) (string, error) {
	if val, ok := lookup("JWT_SECRET"); ok {
		t := strings.TrimSpace(val)
		if t == "" {
			if allowInsecure {
				return insecureJWTFallback, nil
			}
			return "", errJWTEmpty
		}
		if len(t) < JWTSecretMinLen {
			return "", errJWTShort
		}
		return t, nil
	}
	if allowInsecure {
		return insecureJWTFallback, nil
	}
	return "", errJWTMissing
}

var (
	errJWTMissing = errors.New("JWT_SECRET is not set")
	errJWTEmpty   = errors.New("JWT_SECRET is set but empty after trimming")
	errJWTShort   = errors.New("JWT_SECRET must be at least 32 characters (generate one with e.g. openssl rand -base64 48)")
)

// isTruthy: 1, true, yes, on (case-insensitive). Unset or empty => false.
func isTruthy(lookup func(string) (string, bool), key string) bool {
	v, ok := lookup(key)
	if !ok {
		return false
	}
	trim := strings.ToLower(strings.TrimSpace(v))
	if trim == "" {
		return false
	}
	return trim == "1" || trim == "true" || trim == "yes" || trim == "on"
}

// defaultTrueFlag matches Rust flags that default to true: unset, empty, or 1/true/yes/on => true; 0/false/no/off => false.
func defaultTrueFlag(lookup func(string) (string, bool), key string) bool {
	v, ok := lookup(key)
	if !ok {
		return true
	}
	trim := strings.ToLower(strings.TrimSpace(v))
	if trim == "" {
		return true
	}
	if trim == "0" || trim == "false" || trim == "no" || trim == "off" {
		return false
	}
	return trim == "1" || trim == "true" || trim == "yes" || trim == "on"
}

// isFalsy: 0, false, no, off
func isFalsy(lookup func(string) (string, bool), key string) bool {
	v, _ := lookup(key)
	trim := strings.ToLower(strings.TrimSpace(v))
	return trim == "0" || trim == "false" || trim == "no" || trim == "off"
}

func getTrim(lookup func(string) (string, bool), k string) *string {
	if v, ok := lookup(k); ok {
		t := strings.TrimSpace(v)
		if t != "" {
			return &t
		}
	}
	return nil
}

func firstNonEmpty(lookup func(string) (string, bool), k, dflt string) string {
	if t := getTrim(lookup, k); t != nil {
		return *t
	}
	return dflt
}

func fileFromPath(lookup func(string) (string, bool), k string) (string, bool) {
	if p, ok := lookup(k); ok {
		p = strings.TrimSpace(p)
		if p == "" {
			return "", false
		}
		if b, err := os.ReadFile(p); err == nil {
			s := strings.TrimSpace(string(b))
			if s != "" {
				return s, true
			}
		}
	}
	return "", false
}

func parseUint16(s string) (uint16, error) {
	if s == "" {
		return 0, strconv.ErrSyntax
	}
	u, err := strconv.ParseUint(s, 10, 16)
	return uint16(u), err
}

func parseCSVHosts(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		s := strings.TrimSpace(p)
		s = strings.TrimPrefix(s, "*.")
		s = strings.TrimPrefix(s, ".")
		s = strings.ToLower(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
