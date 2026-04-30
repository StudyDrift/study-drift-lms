package feedbackmedia

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FeedbackMediaRow struct {
	ID               uuid.UUID
	SubmissionID     uuid.UUID
	CourseID         uuid.UUID
	ModuleItemID     uuid.UUID
	UploaderID       uuid.UUID
	MediaType        string
	MimeType         string
	StorageKey       string
	ByteSize         int64
	DurationSecs     *int32
	CaptionStatus    string
	CaptionKey       *string
	UploadComplete   bool
	ExpectedByteSize *int64
	BytesReceived    int64
	CreatedAt        time.Time
	DeletedAt        *time.Time
}

func scanMedia(scanner interface{ Scan(...any) error }) (*FeedbackMediaRow, error) {
	var r FeedbackMediaRow
	err := scanner.Scan(&r.ID, &r.SubmissionID, &r.CourseID, &r.ModuleItemID, &r.UploaderID, &r.MediaType, &r.MimeType, &r.StorageKey, &r.ByteSize, &r.DurationSecs, &r.CaptionStatus, &r.CaptionKey, &r.UploadComplete, &r.ExpectedByteSize, &r.BytesReceived, &r.CreatedAt, &r.DeletedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func InsertDraft(ctx context.Context, pool *pgxpool.Pool, id, submissionID, courseID, moduleItemID, uploaderID uuid.UUID, mediaType, mimeType, storageKey string, expectedByteSize int64) (*FeedbackMediaRow, error) {
	return scanMedia(pool.QueryRow(ctx, `
INSERT INTO course.submission_feedback_media (
	id, submission_id, course_id, module_item_id, uploader_id,
	media_type, mime_type, storage_key, expected_byte_size, bytes_received, upload_complete
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,false)
RETURNING id, submission_id, course_id, module_item_id, uploader_id, media_type, mime_type, storage_key, byte_size, duration_secs, caption_status, caption_key, upload_complete, expected_byte_size, bytes_received, created_at, deleted_at
`, id, submissionID, courseID, moduleItemID, uploaderID, mediaType, mimeType, storageKey, expectedByteSize))
}

func InsertFinalized(ctx context.Context, pool *pgxpool.Pool, id, submissionID, courseID, moduleItemID, uploaderID uuid.UUID, mediaType, mimeType, storageKey string, byteSize int64, durationSecs *int32) (*FeedbackMediaRow, error) {
	return scanMedia(pool.QueryRow(ctx, `
INSERT INTO course.submission_feedback_media (
	id, submission_id, course_id, module_item_id, uploader_id,
	media_type, mime_type, storage_key, byte_size, duration_secs, expected_byte_size, bytes_received, upload_complete
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$9,true)
RETURNING id, submission_id, course_id, module_item_id, uploader_id, media_type, mime_type, storage_key, byte_size, duration_secs, caption_status, caption_key, upload_complete, expected_byte_size, bytes_received, created_at, deleted_at
`, id, submissionID, courseID, moduleItemID, uploaderID, mediaType, mimeType, storageKey, byteSize, durationSecs))
}

func AddBytesReceived(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, delta int64) (*FeedbackMediaRow, error) {
	return scanMedia(pool.QueryRow(ctx, `
UPDATE course.submission_feedback_media
SET bytes_received = bytes_received + $2
WHERE id = $1 AND upload_complete = false AND deleted_at IS NULL
RETURNING id, submission_id, course_id, module_item_id, uploader_id, media_type, mime_type, storage_key, byte_size, duration_secs, caption_status, caption_key, upload_complete, expected_byte_size, bytes_received, created_at, deleted_at
`, id, delta))
}

func SetUploadFinalized(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, byteSize int64, durationSecs *int32) (*FeedbackMediaRow, error) {
	return scanMedia(pool.QueryRow(ctx, `
UPDATE course.submission_feedback_media
SET upload_complete = true, byte_size = $2, bytes_received = $2, duration_secs = COALESCE($3, duration_secs)
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, submission_id, course_id, module_item_id, uploader_id, media_type, mime_type, storage_key, byte_size, duration_secs, caption_status, caption_key, upload_complete, expected_byte_size, bytes_received, created_at, deleted_at
`, id, byteSize, durationSecs))
}

func FinalizeChunkedUpload(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, newStorageKey string, byteSize int64, durationSecs *int32) (*FeedbackMediaRow, error) {
	return scanMedia(pool.QueryRow(ctx, `
UPDATE course.submission_feedback_media
SET upload_complete = true, storage_key = $2, byte_size = $3, bytes_received = $3, duration_secs = COALESCE($4, duration_secs)
WHERE id = $1 AND upload_complete = false AND deleted_at IS NULL AND bytes_received = expected_byte_size
RETURNING id, submission_id, course_id, module_item_id, uploader_id, media_type, mime_type, storage_key, byte_size, duration_secs, caption_status, caption_key, upload_complete, expected_byte_size, bytes_received, created_at, deleted_at
`, id, newStorageKey, byteSize, durationSecs))
}

func GetByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*FeedbackMediaRow, error) {
	r, err := scanMedia(pool.QueryRow(ctx, `
SELECT id, submission_id, course_id, module_item_id, uploader_id, media_type, mime_type, storage_key, byte_size, duration_secs, caption_status, caption_key, upload_complete, expected_byte_size, bytes_received, created_at, deleted_at
FROM course.submission_feedback_media
WHERE id = $1
`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func ListForSubmission(ctx context.Context, pool *pgxpool.Pool, submissionID uuid.UUID) ([]FeedbackMediaRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, submission_id, course_id, module_item_id, uploader_id, media_type, mime_type, storage_key, byte_size, duration_secs, caption_status, caption_key, upload_complete, expected_byte_size, bytes_received, created_at, deleted_at
FROM course.submission_feedback_media
WHERE submission_id = $1 AND deleted_at IS NULL
ORDER BY created_at ASC, id ASC
`, submissionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]FeedbackMediaRow, 0)
	for rows.Next() {
		r, err := scanMedia(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func SoftDelete(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `
UPDATE course.submission_feedback_media
SET deleted_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func SetCaptionStatus(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, status string) error {
	_, err := pool.Exec(ctx, `UPDATE course.submission_feedback_media SET caption_status = $2 WHERE id = $1`, id, status)
	return err
}

func SetCaptionDone(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, captionKey string) error {
	_, err := pool.Exec(ctx, `
UPDATE course.submission_feedback_media
SET caption_status = 'done', caption_key = $2
WHERE id = $1
`, id, captionKey)
	return err
}
