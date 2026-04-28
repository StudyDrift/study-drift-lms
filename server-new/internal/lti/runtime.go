package lti

import (
	"strings"

	"github.com/lextures/lextures/server-new/internal/config"
)

// Runtime holds the configured LTI RSA key pair; nil when LTI is not usable.
type Runtime struct {
	Keys *RsaKeyPair
	// APIBaseURL is the LTI iss / platform issuer (no trailing slash).
	APIBaseURL string
	Enabled    bool
}

// NewFromConfig returns nil if LTI is off or the PEM is missing/invalid.
func NewFromConfig(c config.Config) *Runtime {
	if !c.LTIEnabled || strings.TrimSpace(c.LTIRSAPrivateKeyPEM) == "" {
		return nil
	}
	pair, err := FromPKCS8PEM(c.LTIRSAPrivateKeyPEM, c.LTIRSAKeyID)
	if err != nil {
		return nil
	}
	return &Runtime{
		Enabled:    true,
		Keys:       pair,
		APIBaseURL: c.LTIAPIBaseURL,
	}
}
