// user.user_ai_settings — per-user OpenRouter model defaults (mirrors server/src/repos/user_ai_settings.rs).
package user

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Defaults when no row exists (parity with Rust repos/user_ai_settings.rs).
const (
	DefaultImageModelID       = "black-forest-labs/flux.2-flex"
	DefaultCourseSetupModelID = "arcee-ai/trinity-mini:free"
)

// GetImageModelID returns the user's image model, or the global default.
func GetImageModelID(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (string, error) {
	if pool == nil {
		return "", errors.New("db pool is nil")
	}
	var s string
	err := pool.QueryRow(ctx, `SELECT image_model_id FROM "user".user_ai_settings WHERE user_id = $1`, userID).Scan(&s)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultImageModelID, nil
	}
	if err != nil {
		return "", err
	}
	return s, nil
}

// GetCourseSetupModelID returns the user's text model for course setup, or the default.
func GetCourseSetupModelID(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (string, error) {
	if pool == nil {
		return "", errors.New("db pool is nil")
	}
	var s string
	err := pool.QueryRow(ctx, `SELECT course_setup_model_id FROM "user".user_ai_settings WHERE user_id = $1`, userID).Scan(&s)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultCourseSetupModelID, nil
	}
	if err != nil {
		return "", err
	}
	return s, nil
}

// UpsertAISettings sets both models; returns the stored values.
func UpsertAISettings(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, imageModelID, courseSetupModelID string) (imgOut, courseOut string, err error) {
	if pool == nil {
		return "", "", errors.New("db pool is nil")
	}
	err = pool.QueryRow(ctx, `
INSERT INTO "user".user_ai_settings (user_id, image_model_id, course_setup_model_id, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (user_id) DO UPDATE SET
	image_model_id = EXCLUDED.image_model_id,
	course_setup_model_id = EXCLUDED.course_setup_model_id,
	updated_at = now()
RETURNING image_model_id, course_setup_model_id
`, userID, imageModelID, courseSetupModelID).Scan(&imgOut, &courseOut)
	return imgOut, courseOut, err
}
