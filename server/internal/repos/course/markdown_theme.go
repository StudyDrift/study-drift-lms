package course

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// UpdateMarkdownTheme sets markdown reading theme; custom JSON is only stored when preset is "custom".
func UpdateMarkdownTheme(ctx context.Context, pool *pgxpool.Pool, courseCode, preset string, customJSON []byte) (*CoursePublic, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var custom interface{}
	if customJSON == nil {
		custom = nil
	} else {
		custom = customJSON
	}
	tag, err := pool.Exec(ctx, `
UPDATE course.courses c SET
	markdown_theme_preset = $1,
	markdown_theme_custom = $2,
	updated_at = NOW()
WHERE c.course_code = $3
`, preset, custom, courseCode)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}
	return GetPublicByCourseCode(ctx, pool, courseCode)
}

// DefaultMarkdownThemeCustomJSON is `{}` for Rust `MarkdownThemeCustom::default()` when preset is custom and body omits custom.
var DefaultMarkdownThemeCustomJSON = json.RawMessage(`{}`)
