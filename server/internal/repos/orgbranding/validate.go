package orgbranding

import (
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"strings"
)

var hex6 = regexp.MustCompile(`(?i)^#([0-9a-f]{6})$`)

// ValidateHexColor returns normalized #RRGGBB or an error.
func ValidateHexColor(s string) (string, error) {
	t := strings.TrimSpace(s)
	if t == "" {
		return "", fmt.Errorf("empty color")
	}
	m := hex6.FindStringSubmatch(t)
	if m == nil {
		return "", fmt.Errorf("expected #RRGGBB hex color")
	}
	return "#" + strings.ToUpper(m[1]), nil
}

// HexToRGB parses #RRGGBB into 0..255 channels.
func HexToRGB(hexStr string) (r, g, b float64, err error) {
	norm, err := ValidateHexColor(hexStr)
	if err != nil {
		return 0, 0, 0, err
	}
	raw, decErr := hex.DecodeString(strings.TrimPrefix(norm, "#"))
	if decErr != nil || len(raw) != 3 {
		return 0, 0, 0, fmt.Errorf("invalid hex")
	}
	return float64(raw[0]), float64(raw[1]), float64(raw[2]), nil
}

// RelativeLuminanceWCAG computes relative luminance for contrast ratio (sRGB).
func RelativeLuminanceWCAG(hex string) (float64, error) {
	r, g, b, err := HexToRGB(hex)
	if err != nil {
		return 0, err
	}
	ch := []float64{r / 255, g / 255, b / 255}
	for i := range ch {
		v := ch[i]
		if v <= 0.03928 {
			ch[i] = v / 12.92
		} else {
			ch[i] = math.Pow((v+0.055)/1.055, 2.4)
		}
	}
	return 0.2126*ch[0] + 0.7152*ch[1] + 0.0722*ch[2], nil
}

// ContrastRatioAgainstWhite returns contrast ratio of hex on #FFFFFF (rounded 2 decimals).
func ContrastRatioAgainstWhite(hex string) (float64, error) {
	fg, err := RelativeLuminanceWCAG(hex)
	if err != nil {
		return 0, err
	}
	bg := 1.0 // white
	l1, l2 := fg, bg
	if l1 < l2 {
		l1, l2 = l2, l1
	}
	return (l1 + 0.05) / (l2 + 0.05), nil
}

// MeetsWCAGAANormalText is true when contrast vs white is at least 4.5:1.
func MeetsWCAGAANormalText(hex string) (bool, float64, error) {
	ratio, err := ContrastRatioAgainstWhite(hex)
	if err != nil {
		return false, 0, err
	}
	return ratio >= 4.5, ratio, nil
}
