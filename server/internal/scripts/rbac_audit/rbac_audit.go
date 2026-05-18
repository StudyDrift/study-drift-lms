// rbac_audit is a CI helper that fails when hard-coded role-name strings are reintroduced
// into server Go or client TypeScript code outside the allowed exception list.
//
// Usage: go run ./server/internal/scripts/rbac_audit/rbac_audit.go
//
// Exit code 0 = clean; exit code 1 = violations found.
package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// roleStringPattern matches hard-coded role names as string literals.
var roleStringPattern = regexp.MustCompile(`"(student|teacher|instructor|ta|owner|designer|observer|auditor|librarian|parent|global admin)"`)

// allowedPaths are file paths (or path prefixes) where role-string literals are permitted:
// catalog seed migrations, the audit script itself, and test files for the catalog.
var allowedPaths = []string{
	"server/migrations/",
	"server/internal/scripts/rbac_audit/",
	"server/internal/repos/enrollment/enrollment_test.go",
	"server/internal/repos/rbac/rbac_test.go",
}

// allowedFiles are exact base filenames always allowed (e.g. catalog seed tests).
var allowedFiles = []string{
	"rbac_audit.go",
}

func isAllowed(path string) bool {
	norm := filepath.ToSlash(path)
	for _, a := range allowedPaths {
		if strings.Contains(norm, a) {
			return true
		}
	}
	base := filepath.Base(norm)
	for _, f := range allowedFiles {
		if base == f {
			return true
		}
	}
	return false
}

func scanFile(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var violations []string
	scanner := bufio.NewScanner(f)
	lineNum := 0
	for scanner.Scan() {
		lineNum++
		line := scanner.Text()
		lower := strings.ToLower(line)
		if roleStringPattern.MatchString(lower) {
			violations = append(violations, fmt.Sprintf("%s:%d: %s", path, lineNum, strings.TrimSpace(line)))
		}
	}
	return violations, scanner.Err()
}

func walkDir(root, ext string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			// Skip hidden directories and vendor/node_modules.
			name := d.Name()
			if strings.HasPrefix(name, ".") || name == "vendor" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(path, ext) {
			files = append(files, path)
		}
		return nil
	})
	return files, err
}

func main() {
	var allViolations []string

	// Scan Go source files.
	goFiles, err := walkDir("server/internal", ".go")
	if err != nil {
		fmt.Fprintf(os.Stderr, "walk error: %v\n", err)
		os.Exit(2)
	}
	for _, f := range goFiles {
		if isAllowed(f) {
			continue
		}
		vs, err := scanFile(f)
		if err != nil {
			fmt.Fprintf(os.Stderr, "scan error %s: %v\n", f, err)
			continue
		}
		allViolations = append(allViolations, vs...)
	}

	// Scan TypeScript/TSX files.
	for _, ext := range []string{".ts", ".tsx"} {
		tsFiles, err := walkDir("clients/web/src", ext)
		if err != nil {
			fmt.Fprintf(os.Stderr, "walk error: %v\n", err)
			os.Exit(2)
		}
		for _, f := range tsFiles {
			if isAllowed(f) {
				continue
			}
			vs, err := scanFile(f)
			if err != nil {
				fmt.Fprintf(os.Stderr, "scan error %s: %v\n", f, err)
				continue
			}
			allViolations = append(allViolations, vs...)
		}
	}

	if len(allViolations) == 0 {
		fmt.Println("rbac_audit: OK — no hard-coded role strings found.")
		os.Exit(0)
	}

	fmt.Fprintf(os.Stderr, "rbac_audit: FAIL — %d hard-coded role string(s) found.\n\n", len(allViolations))
	fmt.Fprintf(os.Stderr, "These must be replaced with permission checks or catalog lookups.\n")
	fmt.Fprintf(os.Stderr, "See docs/plan/05-multi-tenancy-org-roles/5.11-permission-first-rbac.md §FR-9.\n\n")
	for _, v := range allViolations {
		fmt.Fprintln(os.Stderr, v)
	}
	os.Exit(1)
}
