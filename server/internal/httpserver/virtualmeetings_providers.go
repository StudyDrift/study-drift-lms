package httpserver

import (
	"github.com/lextures/lextures/server/internal/service/video"
)

// jitsiProvider returns a JitsiProvider configured from the effective config.
func (d Deps) jitsiProvider() *video.JitsiProvider {
	cfg := d.effectiveConfig()
	return &video.JitsiProvider{
		BaseURL:   cfg.JitsiBaseURL,
		AppID:     cfg.JitsiAppID,
		AppSecret: cfg.JitsiAppSecret,
	}
}

// bbbProvider returns a BBBProvider when BBB is configured, or nil when not.
func (d Deps) bbbProvider() *video.BBBProvider {
	cfg := d.effectiveConfig()
	if cfg.BBBBaseURL == "" || cfg.BBBSecret == "" {
		return nil
	}
	return &video.BBBProvider{
		BaseURL: cfg.BBBBaseURL,
		Secret:  cfg.BBBSecret,
	}
}
