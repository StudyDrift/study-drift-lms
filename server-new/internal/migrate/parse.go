package migrate

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// migrationFile holds metadata parsed from a filename like 001_users.sql
type migrationFile struct {
	Version     int
	Description string
	Name        string
}

var migrationName = regexp.MustCompile(`^([0-9]+)_(.+)\.sql$`)

func parseMigrationName(filename string) (migrationFile, error) {
	base := filename
	if i := strings.LastIndex(filename, "/"); i >= 0 {
		base = filename[i+1:]
	}
	m := migrationName.FindStringSubmatch(base)
	if len(m) != 3 {
		return migrationFile{}, fmt.Errorf("migration: invalid file name %q (expected NNN_desc.sql)", filename)
	}
	v, err := strconv.Atoi(m[1])
	if err != nil {
		return migrationFile{}, err
	}
	if v < 0 {
		return migrationFile{}, fmt.Errorf("migration: negative version in %q", filename)
	}
	return migrationFile{
		Version:     v,
		Description: m[2],
		Name:        base,
	}, nil
}

type byVersion []migrationFile

func (a byVersion) Len() int           { return len(a) }
func (a byVersion) Less(i, j int) bool { return a[i].Version < a[j].Version }
func (a byVersion) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }

func sortMigrations(files []migrationFile) {
	sort.Sort(byVersion(files))
}
