package migrate

import (
	"testing"
)

func TestMigrateRepairChecksumsEnabled(t *testing.T) {
	t.Setenv("MIGRATE_REPAIR_CHECKSUMS", "")
	if migrateRepairChecksumsEnabled() {
		t.Fatal("expected disabled when unset")
	}
	t.Setenv("MIGRATE_REPAIR_CHECKSUMS", "1")
	if !migrateRepairChecksumsEnabled() {
		t.Fatal("expected enabled for 1")
	}
	t.Setenv("MIGRATE_REPAIR_CHECKSUMS", "TRUE")
	if !migrateRepairChecksumsEnabled() {
		t.Fatal("expected enabled for TRUE")
	}
}
