package browsersaml

import (
	"regexp"
)

var (
	reInResponseTo = regexp.MustCompile(`(?i)InResponseTo\s*=\s*"([^"]*)"`)
	reResponseID   = regexp.MustCompile(`(?i)<[a-z0-9-]+:Response[^>]*\bID\s*=\s*"([^"]*)"`)
)

// ScanSAMLResponseShallow extracts InResponseTo and Response@ID from raw SAML XML (Rust parity).
func ScanSAMLResponseShallow(xml string) (inResponseTo *string, responseID *string) {
	if m := reInResponseTo.FindStringSubmatch(xml); len(m) > 1 && m[1] != "" {
		inResponseTo = &m[1]
	}
	if m := reResponseID.FindStringSubmatch(xml); len(m) > 1 {
		responseID = &m[1]
	}
	return
}
