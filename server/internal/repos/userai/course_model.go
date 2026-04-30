// Package userai reads and updates per-user AI settings (table "user".user_ai_settings).
package userai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultCourseSetupModelID matches server/src/repos/user_ai_settings.rs DEFAULT_COURSE_SETUP_MODEL_ID.
const DefaultCourseSetupModelID = "arcee-ai/trinity-mini:free"

// GetCourseSetupModelID returns the user's course setup (chat) model, or the default if unset.
func GetCourseSetupModelID(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (string, error) {
	if pool == nil {
		return "", fmt.Errorf("userai: nil pool")
	}
	var model string
	err := pool.QueryRow(ctx, `
		SELECT course_setup_model_id
		FROM "user".user_ai_settings
		WHERE user_id = $1
	`, userID).Scan(&model)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DefaultCourseSetupModelID, nil
		}
		return "", err
	}
	if strings.TrimSpace(model) == "" {
		return DefaultCourseSetupModelID, nil
	}
	return model, nil
}
