package coursefiles

import "os"

// RemoveStoredBlobs mirrors Rust `course_files::remove_stored_blobs`.
func RemoveStoredBlobs(root, courseCode string, storageKeys []string) {
	for _, key := range storageKeys {
		_ = os.Remove(BlobDiskPath(root, courseCode, key))
	}
}
