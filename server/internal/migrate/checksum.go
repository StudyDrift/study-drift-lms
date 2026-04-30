package migrate

import (
	"crypto/sha512"
)

// sqlxChecksum is the SHA-384 digest of the migration file bytes, matching libsqlx / launchbadge/sqlx.
func sqlxChecksum(sql []byte) [48]byte {
	return sha512.Sum384(sql)
}
