// Package translation manages the content_translations cache table (plan 6.10).
package translation

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CachedTranslation holds a previously stored translation.
type CachedTranslation struct {
	SourceLang string
	Translated string
	Provider   string
}

// Lookup returns a cached translation for the given content, or nil if not cached.
func Lookup(ctx context.Context, pool *pgxpool.Pool, contentType string, contentID uuid.UUID, targetLang string) (*CachedTranslation, error) {
	var t CachedTranslation
	err := pool.QueryRow(ctx, `
		SELECT source_lang, translated, provider
		FROM course.content_translations
		WHERE content_type = $1 AND content_id = $2 AND target_lang = $3
	`, contentType, contentID, targetLang).Scan(&t.SourceLang, &t.Translated, &t.Provider)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// Store inserts or updates a translation in the cache.
func Store(ctx context.Context, pool *pgxpool.Pool, contentType string, contentID uuid.UUID, sourceLang, targetLang, translated, provider string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO course.content_translations (content_type, content_id, source_lang, target_lang, translated, provider)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (content_type, content_id, target_lang)
		DO UPDATE SET source_lang = EXCLUDED.source_lang, translated = EXCLUDED.translated, provider = EXCLUDED.provider
	`, contentType, contentID, sourceLang, targetLang, translated, provider)
	return err
}
