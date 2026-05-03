// Package deviceua turns User-Agent into a short device label (plan 4.9).
package deviceua

import (
	"strings"
)

// Label returns a short label like "Chrome on Windows" or "Unknown device" when empty.
func Label(userAgent string) string {
	ua := strings.TrimSpace(userAgent)
	if ua == "" {
		return "Unknown device"
	}
	browser := pickBrowser(ua)
	os := pickOS(ua)
	if browser != "" && os != "" {
		return browser + " on " + os
	}
	if browser != "" {
		return browser
	}
	if os != "" {
		return os
	}
	return "Unknown device"
}

func pickBrowser(ua string) string {
	l := strings.ToLower(ua)
	switch {
	case strings.Contains(l, "edg/"):
		return "Edge"
	case strings.Contains(l, "opr/") || strings.Contains(l, "opera"):
		return "Opera"
	case strings.Contains(l, "chrome/") || strings.Contains(l, "crios/"):
		return "Chrome"
	case strings.Contains(l, "firefox/") || strings.Contains(l, "fxios/"):
		return "Firefox"
	case strings.Contains(l, "safari/") && strings.Contains(l, "version/"):
		return "Safari"
	case strings.Contains(l, "msie") || strings.Contains(l, "trident/"):
		return "Internet Explorer"
	default:
		return ""
	}
}

func pickOS(ua string) string {
	l := strings.ToLower(ua)
	switch {
	case strings.Contains(l, "iphone"):
		return "iPhone"
	case strings.Contains(l, "ipad"):
		return "iPad"
	case strings.Contains(l, "android"):
		return "Android"
	case strings.Contains(l, "mac os x") || strings.Contains(l, "macintosh"):
		return "macOS"
	case strings.Contains(l, "windows nt"):
		return "Windows"
	case strings.Contains(l, "linux"):
		return "Linux"
	default:
		return ""
	}
}
