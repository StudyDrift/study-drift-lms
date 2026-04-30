package irt

import (
	"os"
	"strings"
)

func catModeEnabled() bool {
	v, ok := os.LookupEnv("IRT_CAT_MODE_ENABLED")
	if !ok {
		return false
	}
	s := strings.TrimSpace(strings.ToLower(v))
	return s == "1" || s == "true" || s == "yes" || s == "on"
}
