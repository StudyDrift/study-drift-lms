// Package sqlfiles embeds the SQL migration set for the Go application.
// SQL files in this directory use the same naming and ordering as the Rust / sqlx setup.
package sqlfiles

import "embed"

// Files contains every `NNN_*.sql` file in this directory.
//
//go:embed *.sql
var Files embed.FS
