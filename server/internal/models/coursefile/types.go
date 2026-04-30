package coursefile

import "github.com/google/uuid"

type CourseFileUploadResponse struct {
	ID          uuid.UUID `json:"id"`
	ContentPath string    `json:"content_path"`
	MimeType    string    `json:"mime_type"`
	ByteSize    int64     `json:"byte_size"`
}
