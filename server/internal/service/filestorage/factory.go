package filestorage

import (
	"fmt"
	"strings"
)

// BackendConfig is the minimal config the factory needs.
type BackendConfig struct {
	Backend         string // "local", "s3", "r2", "minio"
	LocalRoot       string
	Endpoint        string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	UseSSL          bool
	Region          string
}

// New returns a Driver for the configured backend.
func New(cfg BackendConfig) (Driver, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Backend)) {
	case "", "local":
		root := cfg.LocalRoot
		if root == "" {
			root = "data/course-files"
		}
		return &LocalDriver{Root: root}, nil
	case "s3", "r2", "minio":
		endpoint := cfg.Endpoint
		if endpoint == "" {
			if cfg.Backend == "s3" {
				endpoint = "s3.amazonaws.com"
			} else {
				return nil, fmt.Errorf("filestorage: STORAGE_ENDPOINT is required for backend %q", cfg.Backend)
			}
		}
		return NewS3Driver(S3Config{
			Endpoint:        endpoint,
			AccessKeyID:     cfg.AccessKeyID,
			SecretAccessKey: cfg.SecretAccessKey,
			Bucket:          cfg.Bucket,
			UseSSL:          cfg.UseSSL,
			Region:          cfg.Region,
		})
	default:
		return nil, fmt.Errorf("filestorage: unknown backend %q (supported: local, s3, r2, minio)", cfg.Backend)
	}
}
