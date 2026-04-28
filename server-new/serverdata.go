// Package serverdata holds server-wide embedded assets. It lives at the module root
// so go:embed can see the top-level ./migrations directory.
package serverdata

import "embed"

// Migrations is the SQLx 001–115 tree (a byte-for-byte copy of server/migrations).
//
//go:embed all:migrations
var Migrations embed.FS
