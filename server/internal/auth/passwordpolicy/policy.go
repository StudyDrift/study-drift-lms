// Package passwordpolicy enforces memorised-secret rules (NIST-aligned defaults).
package passwordpolicy

import (
	"strings"
	"unicode"

	pwdb "github.com/lextures/lextures/server/internal/repos/passwordpolicy"
)

// Policy is the effective password rules for one request.
type Policy struct {
	MinLength      int
	RequireUpper   bool
	RequireLower   bool
	RequireDigit   bool
	RequireSpecial bool
	CheckHIBP      bool
}

// FromDBRow maps a stored policy row.
func FromDBRow(r pwdb.Row) Policy {
	return Policy{
		MinLength:      r.MinLength,
		RequireUpper:   r.RequireUpper,
		RequireLower:   r.RequireLower,
		RequireDigit:   r.RequireDigit,
		RequireSpecial: r.RequireSpecial,
		CheckHIBP:      r.CheckHIBP,
	}
}

// BreachMessage is returned when HIBP reports a hit.
const BreachMessage = "This password has appeared in a data breach. Please choose a different password."

// LocalViolations returns machine-oriented violation codes (also suitable as i18n keys).
func (p Policy) LocalViolations(password string) []string {
	var v []string
	if len(password) < p.MinLength {
		v = append(v, "password.min_length")
	}
	if p.RequireUpper && !strings.ContainsFunc(password, unicode.IsUpper) {
		v = append(v, "password.require_upper")
	}
	if p.RequireLower && !strings.ContainsFunc(password, unicode.IsLower) {
		v = append(v, "password.require_lower")
	}
	if p.RequireDigit && !strings.ContainsFunc(password, unicode.IsDigit) {
		v = append(v, "password.require_digit")
	}
	if p.RequireSpecial && !hasSpecial(password) {
		v = append(v, "password.require_special")
	}
	return v
}

func hasSpecial(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			continue
		}
		// punctuation, symbols, space counts as "special" for policy purposes
		return true
	}
	return false
}

// HumanDetail builds a single human-readable sentence from violations (English).
func HumanDetail(p Policy, violations []string) string {
	if len(violations) == 0 {
		return ""
	}
	var parts []string
	for _, code := range violations {
		switch code {
		case "password.min_length":
			parts = append(parts, "Use at least "+itoa(p.MinLength)+" characters.")
		case "password.require_upper":
			parts = append(parts, "Include at least one uppercase letter.")
		case "password.require_lower":
			parts = append(parts, "Include at least one lowercase letter.")
		case "password.require_digit":
			parts = append(parts, "Include at least one digit.")
		case "password.require_special":
			parts = append(parts, "Include at least one symbol or punctuation character.")
		default:
			parts = append(parts, "Password does not meet requirements.")
		}
	}
	return strings.Join(parts, " ")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// StrengthWeak / Fair / Strong for UI (i18n keys).
const (
	StrengthWeak   = "password.strength.weak"
	StrengthFair   = "password.strength.fair"
	StrengthStrong = "password.strength.strong"
)

// StrengthLabel returns an i18n key for a simple heuristic (length + character classes).
func StrengthLabel(password string) string {
	classes := 0
	if strings.ContainsFunc(password, unicode.IsUpper) {
		classes++
	}
	if strings.ContainsFunc(password, unicode.IsLower) {
		classes++
	}
	if strings.ContainsFunc(password, unicode.IsDigit) {
		classes++
	}
	if hasSpecial(password) {
		classes++
	}
	n := len(password)
	switch {
	case n < 8 || classes <= 1:
		return StrengthWeak
	case n >= 12 && classes >= 3:
		return StrengthStrong
	default:
		return StrengthFair
	}
}

// StrengthDisplayEnglish maps Strength* keys to English labels for the web client fallback.
func StrengthDisplayEnglish(key string) string {
	switch key {
	case StrengthWeak:
		return "Weak"
	case StrengthFair:
		return "Fair"
	case StrengthStrong:
		return "Strong"
	default:
		return ""
	}
}
