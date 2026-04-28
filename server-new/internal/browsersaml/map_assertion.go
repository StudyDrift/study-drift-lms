package browsersaml

import (
	"encoding/json"
	"strings"

	samllib "github.com/crewjam/saml"

	"github.com/lextures/lextures/server-new/internal/repos/samlidp"
	"github.com/lextures/lextures/server-new/internal/repos/user"
)

// MapAssertion extracts email + optional names (Rust `map_assertion`).
func MapAssertion(a *samllib.Assertion, idp *samlidp.IDPRow) (email string, first, last *string, err error) {
	var mapping map[string]string
	_ = json.Unmarshal(idp.AttributeMapping, &mapping)
	emailWants := []string{
		"urn:oid:0.9.2342.19200300.100.1.3",
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
		"mail", "email", "uid",
	}
	if e := mapStr(mapping, "email"); e != "" {
		emailWants = append([]string{e}, emailWants...)
	}
	firstWants := []string{
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
		"firstName", "first_name", "givenName",
	}
	if e := mapStr(mapping, "firstName"); e != "" {
		firstWants = append([]string{e}, firstWants...)
	}
	lastWants := []string{
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
		"lastName", "last_name", "sn", "surname",
	}
	if e := mapStr(mapping, "lastName"); e != "" {
		lastWants = append([]string{e}, lastWants...)
	}

	em := strings.TrimSpace(getAttr(a, emailWants))
	if em == "" && a.Subject != nil && a.Subject.NameID != nil && strings.Contains(a.Subject.NameID.Value, "@") {
		em = strings.TrimSpace(a.Subject.NameID.Value)
	}
	fn := strings.TrimSpace(getAttr(a, firstWants))
	ln := strings.TrimSpace(getAttr(a, lastWants))
	em = user.NormalizeEmail(em)
	if fn != "" {
		first = &fn
	}
	if ln != "" {
		last = &ln
	}
	return em, first, last, nil
}

func mapStr(m map[string]string, k string) string {
	if m == nil {
		return ""
	}
	return strings.TrimSpace(m[k])
}

func getAttr(a *samllib.Assertion, wanted []string) string {
	wl := make([]string, 0, len(wanted))
	for _, w := range wanted {
		if w == "" {
			continue
		}
		wl = append(wl, strings.ToLower(strings.TrimSpace(w)))
	}
	for _, stmt := range a.AttributeStatements {
		for _, att := range stmt.Attributes {
			nl := strings.ToLower(strings.TrimSpace(att.Name))
			fl := strings.ToLower(strings.TrimSpace(att.FriendlyName))
			for _, w := range wl {
				if (nl != "" && nl == w) || (fl != "" && fl == w) {
					if len(att.Values) > 0 {
						return strings.TrimSpace(att.Values[0].Value)
					}
				}
			}
		}
	}
	return ""
}
