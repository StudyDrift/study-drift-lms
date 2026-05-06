package deviceua

import "testing"

func TestLabel(t *testing.T) {
	cases := map[string]string{
		"":      "Unknown device",
		"   ":   "Unknown device",
		"junk":  "Unknown device",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36":      "Chrome on Windows",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15": "Safari on macOS",
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/120.0":                                  "Firefox on Linux",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Safari/605.1.15 Version/16.0":                                   "Safari on iPhone",
		"Mozilla/5.0 (iPad; CPU OS 16_0) Safari/605.1.15 Version/16.0":                                                          "Safari on iPad",
		"Mozilla/5.0 (Linux; Android 13) Chrome/120.0":                                                                          "Chrome on Android",
		"Mozilla/5.0 (Windows NT 10.0) Edg/120.0":                                                                               "Edge on Windows",
		"Mozilla/5.0 (Windows NT 10.0) OPR/100.0":                                                                               "Opera on Windows",
		"Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)":                                                      "Internet Explorer on Windows",
		"Chrome/120.0":           "Chrome",
		"Macintosh; Intel Mac OS X": "macOS",
	}
	for ua, want := range cases {
		if got := Label(ua); got != want {
			t.Errorf("Label(%q) = %q, want %q", ua, got, want)
		}
	}
}
