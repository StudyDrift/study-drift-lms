// Package authz implements scope:area:function:action permission matching (Rust server/src/authz.rs).
package authz

import "strings"

// PermissionMatches returns true when granted authorizes required (both four : segments).
func PermissionMatches(granted, required string) bool {
	gParts := strings.Split(strings.TrimSpace(granted), ":")
	rParts := strings.Split(strings.TrimSpace(required), ":")
	if len(gParts) != 4 || len(rParts) != 4 {
		return false
	}
	for i := 0; i < 4; i++ {
		if !segmentMatches(gParts[i], rParts[i]) {
			return false
		}
	}
	return true
}

func segmentMatches(g, r string) bool {
	return g == "*" || r == "*" || g == r
}

// AnyGrantMatch returns true if any grant in grants matches required.
func AnyGrantMatch(grants []string, required string) bool {
	for _, g := range grants {
		if PermissionMatches(g, required) {
			return true
		}
	}
	return false
}
