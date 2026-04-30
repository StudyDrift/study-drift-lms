package migrate

import "testing"

func TestParseMigrationName(t *testing.T) {
	m, err := parseMigrationName("migrations/001_users.sql")
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != 1 || m.Description != "users" || m.Name != "001_users.sql" {
		t.Fatalf("got %#v", m)
	}
	if _, err := parseMigrationName("bad.txt"); err == nil {
		t.Fatalf("expected error")
	}
}

func TestSortMigrations(t *testing.T) {
	a := []migrationFile{
		{Version: 3, Name: "003_c.sql", Description: "c"},
		{Version: 1, Name: "001_a.sql", Description: "a"},
	}
	sortMigrations(a)
	if a[0].Version != 1 {
		t.Fatalf("order: %#v", a)
	}
}
