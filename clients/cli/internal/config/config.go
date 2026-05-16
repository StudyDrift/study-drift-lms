package config

import (
	"errors"
	"fmt"
	"os"

	"github.com/spf13/viper"
)

const DefaultServer = "https://app.lextures.com"

type Profile struct {
	Server string `mapstructure:"server"`
	WebURL string `mapstructure:"web_url"`
	APIKey string `mapstructure:"api_key"`
}

type Config struct {
	Version  int                `mapstructure:"version"`
	Server   string             `mapstructure:"server"`
	WebURL   string             `mapstructure:"web_url"`
	APIKey   string             `mapstructure:"api_key"`
	JSON     bool               `mapstructure:"json"`
	Profiles map[string]Profile `mapstructure:"profiles"`
}

// LoadOptions holds the values from CLI flags (highest precedence layer).
type LoadOptions struct {
	ConfigFile string
	Profile    string
	Server     string
	APIKey     string
	JSON       bool
}

// Load reads configuration from file, env vars, and flag overrides in order
// of increasing precedence: defaults < file < env < flags.
func Load(opts LoadOptions) (*Config, error) {
	v := viper.New()

	v.SetDefault("version", 1)
	v.SetDefault("server", DefaultServer)
	v.SetDefault("json", false)

	if opts.ConfigFile != "" {
		v.SetConfigFile(opts.ConfigFile)
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("cannot determine home directory: %w", err)
		}
		v.SetConfigName(".lextures")
		v.SetConfigType("yaml")
		v.AddConfigPath(home)
	}

	// Env vars sit between file and flags.
	v.SetEnvPrefix("LEXTURES")
	_ = v.BindEnv("server", "LEXTURES_SERVER")
	_ = v.BindEnv("web_url", "LEXTURES_WEB_URL")
	_ = v.BindEnv("api_key", "LEXTURES_API_KEY")
	_ = v.BindEnv("json", "LEXTURES_JSON")

	if err := v.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !errors.As(err, &notFound) {
			return nil, fmt.Errorf("error reading config file: %w", err)
		}
	} else {
		warnIfPermissive(v.ConfigFileUsed())
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("error parsing config: %w", err)
	}

	// Apply profile (env/file layer).
	if opts.Profile != "" {
		p, ok := cfg.Profiles[opts.Profile]
		if !ok {
			return nil, fmt.Errorf("profile %q not found in config", opts.Profile)
		}
		if p.Server != "" {
			cfg.Server = p.Server
		}
		if p.WebURL != "" {
			cfg.WebURL = p.WebURL
		}
		if p.APIKey != "" {
			cfg.APIKey = p.APIKey
		}
	}

	// WebURL falls back to Server when unset.
	if cfg.WebURL == "" {
		cfg.WebURL = cfg.Server
	}

	// Flag overrides are highest precedence.
	if opts.Server != "" {
		cfg.Server = opts.Server
	}
	if opts.APIKey != "" {
		cfg.APIKey = opts.APIKey
	}
	if opts.JSON {
		cfg.JSON = true
	}

	return &cfg, nil
}

// warnIfPermissive prints a warning if the config file has group/other read bits.
func warnIfPermissive(path string) {
	info, err := os.Stat(path)
	if err != nil {
		return
	}
	if info.Mode().Perm()&0o077 != 0 {
		fmt.Fprintf(os.Stderr, "warning: config file %s has permissions %04o; recommend 0600\n",
			path, info.Mode().Perm())
	}
}
