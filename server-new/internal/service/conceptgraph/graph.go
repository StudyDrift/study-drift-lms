// Package conceptgraph implements `server/src/services/concept_graph.rs` (slugging, prerequisites, edge gauge).
package conceptgraph

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server-new/internal/repos/concepts"
)

var edgeCount atomic.Int64

func init() {
	edgeCount.Store(-1)
}

// ErrSelfPrerequisite is returned when concept_id == prerequisite_id.
var ErrSelfPrerequisite = errors.New("conceptgraph: a concept cannot be a prerequisite of itself")

// ErrCircularPrerequisite is returned when an edge would close a cycle.
var ErrCircularPrerequisite = errors.New("conceptgraph: prerequisite would create a circular dependency")

// SyncEdgeCount refreshes the in-process edge gauge (Rust `sync_edge_count`).
func SyncEdgeCount(ctx context.Context, pool *pgxpool.Pool) {
	n, err := concepts.CountPrerequisiteEdges(ctx, pool)
	if err != nil {
		return
	}
	edgeCount.Store(n)
}

// ApproximateEdgeCount returns the last synced count, or nil if never synced.
func ApproximateEdgeCount() *int64 {
	v := edgeCount.Load()
	if v < 0 {
		return nil
	}
	return &v
}

// SlugifyName mirrors `slugify_name` in Rust.
func SlugifyName(name string) string {
	s := strings.TrimSpace(strings.ToLower(name))
	var b strings.Builder
	prevSep := true
	for _, ch := range s {
		if isASCIILetterOrDigit(ch) {
			b.WriteRune(ch)
			prevSep = false
		} else if (unicode.IsSpace(ch) || ch == '-' || ch == '_') && b.Len() > 0 && !prevSep {
			b.WriteRune('-')
			prevSep = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "concept"
	}
	return out
}

func isASCIILetterOrDigit(ch rune) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
}

// EnsureUniqueSlug appends short suffixes until unused (global slug uniqueness).
func EnsureUniqueSlug(ctx context.Context, pool *pgxpool.Pool, base string) (string, error) {
	candidate := base
	for i := 0; i < 64; i++ {
		existing, err := concepts.GetBySlug(ctx, pool, candidate)
		if err != nil {
			return "", err
		}
		if existing == nil {
			return candidate, nil
		}
		suf := uuid.New().String()
		if len(suf) > 8 {
			suf = suf[:8]
		}
		candidate = fmt.Sprintf("%s-%s", base, suf)
	}
	return fmt.Sprintf("%s-%s", base, strings.ReplaceAll(uuid.New().String(), "-", "")), nil
}

// AddPrerequisite inserts a prerequisite edge with cycle checks (serializable transaction).
func AddPrerequisite(ctx context.Context, pool *pgxpool.Pool, conceptID, prerequisiteID uuid.UUID) error {
	if conceptID == prerequisiteID {
		return ErrSelfPrerequisite
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`); err != nil {
		return err
	}
	reaches, err := concepts.PrerequisiteReachesConcept(ctx, tx, prerequisiteID, conceptID)
	if err != nil {
		return err
	}
	if reaches {
		return ErrCircularPrerequisite
	}
	if err := concepts.InsertPrerequisiteEdge(ctx, tx, conceptID, prerequisiteID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	SyncEdgeCount(ctx, pool)
	return nil
}

// CreateConcept creates a new global concept with a unique slug.
func CreateConcept(ctx context.Context, pool *pgxpool.Pool, name string, description *string, bloomLevel *string, parentConceptID *uuid.UUID) (JSON, error) {
	base := SlugifyName(name)
	slug, err := EnsureUniqueSlug(ctx, pool, base)
	if err != nil {
		return JSON{}, err
	}
	row, err := concepts.InsertConcept(ctx, pool, &concepts.InsertConceptInput{
		Slug:            slug,
		Name:            name,
		Description:     description,
		BloomLevel:      bloomLevel,
		ParentConceptID: parentConceptID,
	})
	if err != nil {
		return JSON{}, err
	}
	return RowToJSON(*row), nil
}

// UpdateConcept updates an existing row (name required in Rust service — pass non-empty name).
func UpdateConcept(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, name string, description *string, bloomLevel *string, parentConceptID **uuid.UUID) (*JSON, error) {
	patch := &concepts.UpdateConceptInput{
		Name:            &name,
		Description:     description,
		BloomLevel:      bloomLevel,
		ParentConceptID: parentConceptID,
	}
	row, err := concepts.UpdateConcept(ctx, pool, id, patch)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	j := RowToJSON(*row)
	return &j, nil
}

// DeletePrerequisiteEdge removes an edge; refreshes the gauge if something was deleted.
func DeletePrerequisiteEdge(ctx context.Context, pool *pgxpool.Pool, conceptID, prerequisiteID uuid.UUID) (bool, error) {
	ok, err := concepts.DeletePrerequisiteEdge(ctx, pool, conceptID, prerequisiteID)
	if err != nil {
		return false, err
	}
	if ok {
		SyncEdgeCount(ctx, pool)
	}
	return ok, nil
}
