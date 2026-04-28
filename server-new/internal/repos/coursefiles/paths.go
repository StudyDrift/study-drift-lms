package coursefiles

import (
	"path/filepath"
	"strings"
)

// diskCourseDirSegment matches `server/src/repos/course_files::disk_course_dir_segment`.
func diskCourseDirSegment(courseCode string) string {
	t := strings.TrimSpace(courseCode)
	if t == "" {
		return "_unknown"
	}
	var b strings.Builder
	n := 0
	for _, c := range t {
		if n >= 200 {
			break
		}
		n++
		if c <= 0x7f {
			if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
				b.WriteRune(c)
			} else if c == '-' || c == '_' || c == '.' {
				b.WriteRune(c)
			} else {
				b.WriteRune('_')
			}
		} else {
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "_unknown"
	}
	return b.String()
}

// BlobDiskPath returns the on-disk path for a stored blob (Rust `blob_disk_path`).
func BlobDiskPath(root, courseCode, storageKey string) string {
	seg := diskCourseDirSegment(courseCode)
	// storage_key is a single path segment from our app; still cleanpath for safety
	key := filepath.Base(storageKey)
	return filepath.Join(root, seg, key)
}
