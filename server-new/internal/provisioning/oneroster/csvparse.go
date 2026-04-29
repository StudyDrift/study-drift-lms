package oneroster

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ErrMissingColumn is returned when a required CSV column is absent.
type ErrMissingColumn struct {
	File   string
	Column string
}

func (e ErrMissingColumn) Error() string {
	return fmt.Sprintf("%s: missing required column %q", e.File, e.Column)
}

func stripBOM(b []byte) []byte {
	return bytes.TrimPrefix(b, []byte{0xef, 0xbb, 0xbf})
}

// parseCSV reads r as UTF-8 CSV (with optional BOM) and returns header + rows.
func parseCSV(name string, r io.Reader) ([]string, [][]string, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: read: %w", name, err)
	}
	raw = stripBOM(raw)
	cr := csv.NewReader(bytes.NewReader(raw))
	cr.FieldsPerRecord = -1
	cr.ReuseRecord = false
	cr.LazyQuotes = true
	cr.TrimLeadingSpace = true
	header, err := cr.Read()
	if err != nil {
		if errors.Is(err, io.EOF) {
			return nil, nil, fmt.Errorf("%s: empty file", name)
		}
		return nil, nil, fmt.Errorf("%s: header: %w", name, err)
	}
	for i := range header {
		header[i] = strings.TrimSpace(header[i])
	}
	var rows [][]string
	for {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, nil, fmt.Errorf("%s: row: %w", name, err)
		}
		if rowEmpty(rec) {
			continue
		}
		rows = append(rows, rec)
	}
	return header, rows, nil
}

func rowEmpty(rec []string) bool {
	for _, c := range rec {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

func headerIndex(header []string) map[string]int {
	m := make(map[string]int, len(header))
	for i, h := range header {
		key := strings.ToLower(strings.TrimSpace(h))
		if _, ok := m[key]; !ok {
			m[key] = i
		}
	}
	return m
}

func requireCol(idx map[string]int, file, col string) (int, error) {
	i, ok := idx[strings.ToLower(col)]
	if !ok {
		return 0, ErrMissingColumn{File: file, Column: col}
	}
	return i, nil
}

func getCol(rec []string, idx map[string]int, col string) string {
	i, ok := idx[strings.ToLower(col)]
	if !ok || i < 0 || i >= len(rec) {
		return ""
	}
	return strings.TrimSpace(rec[i])
}
