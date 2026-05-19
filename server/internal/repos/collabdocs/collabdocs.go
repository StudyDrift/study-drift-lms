// Package collabdocs provides database access for collaborative documents (plan 6.5).
package collabdocs

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Doc represents a collaborative document row.
type Doc struct {
	ID        uuid.UUID  `json:"id"`
	CourseID  uuid.UUID  `json:"courseId"`
	GroupID   *uuid.UUID `json:"groupId"`
	Title     string     `json:"title"`
	DocType   string     `json:"docType"`
	CreatedBy uuid.UUID  `json:"createdBy"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

// Snapshot represents one edit-history snapshot.
type Snapshot struct {
	ID       uuid.UUID `json:"id"`
	DocID    uuid.UUID `json:"docId"`
	AuthorID uuid.UUID `json:"authorId"`
	TakenAt  time.Time `json:"takenAt"`
}

// Create inserts a new collaborative document and returns the row.
func Create(ctx context.Context, pool *pgxpool.Pool, courseID, createdBy uuid.UUID, title, docType string) (*Doc, error) {
	const q = `
		INSERT INTO collab.collaborative_documents (course_id, title, doc_type, created_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id, course_id, group_id, title, doc_type, created_by, created_at, updated_at
	`
	var d Doc
	var gid *uuid.UUID
	err := pool.QueryRow(ctx, q, courseID, title, docType, createdBy).
		Scan(&d.ID, &d.CourseID, &gid, &d.Title, &d.DocType, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	d.GroupID = gid
	return &d, nil
}

// List returns all documents for a course.
func List(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]Doc, error) {
	const q = `
		SELECT id, course_id, group_id, title, doc_type, created_by, created_at, updated_at
		FROM collab.collaborative_documents
		WHERE course_id = $1
		ORDER BY created_at DESC
	`
	rows, err := pool.Query(ctx, q, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Doc
	for rows.Next() {
		var d Doc
		var gid *uuid.UUID
		if err := rows.Scan(&d.ID, &d.CourseID, &gid, &d.Title, &d.DocType, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		d.GroupID = gid
		out = append(out, d)
	}
	return out, rows.Err()
}

// Get returns a single document, or nil if not found.
func Get(ctx context.Context, pool *pgxpool.Pool, docID uuid.UUID) (*Doc, error) {
	const q = `
		SELECT id, course_id, group_id, title, doc_type, created_by, created_at, updated_at
		FROM collab.collaborative_documents
		WHERE id = $1
	`
	var d Doc
	var gid *uuid.UUID
	err := pool.QueryRow(ctx, q, docID).
		Scan(&d.ID, &d.CourseID, &gid, &d.Title, &d.DocType, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.GroupID = gid
	return &d, nil
}

// BelongsToCourse returns true if the document belongs to the given course.
func BelongsToCourse(ctx context.Context, pool *pgxpool.Pool, courseID, docID uuid.UUID) (bool, error) {
	var n int
	err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM collab.collaborative_documents WHERE id=$1 AND course_id=$2`,
		docID, courseID,
	).Scan(&n)
	return n > 0, err
}

// PatchTitle updates the document title.
func PatchTitle(ctx context.Context, pool *pgxpool.Pool, docID uuid.UUID, title string) (*Doc, error) {
	const q = `
		UPDATE collab.collaborative_documents
		SET title = $1, updated_at = NOW()
		WHERE id = $2
		RETURNING id, course_id, group_id, title, doc_type, created_by, created_at, updated_at
	`
	var d Doc
	var gid *uuid.UUID
	err := pool.QueryRow(ctx, q, title, docID).
		Scan(&d.ID, &d.CourseID, &gid, &d.Title, &d.DocType, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.GroupID = gid
	return &d, nil
}

// Delete removes a document (cascades to updates and snapshots).
func Delete(ctx context.Context, pool *pgxpool.Pool, docID uuid.UUID) error {
	_, err := pool.Exec(ctx, `DELETE FROM collab.collaborative_documents WHERE id = $1`, docID)
	return err
}

// StoreUpdate persists a raw Y.js binary update.
func StoreUpdate(ctx context.Context, pool *pgxpool.Pool, docID, authorID uuid.UUID, update []byte) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO collab.collab_doc_updates (doc_id, author_id, update) VALUES ($1, $2, $3)`,
		docID, authorID, update,
	)
	return err
}

// GetAllUpdates returns all stored Y.js updates for a document in chronological order.
func GetAllUpdates(ctx context.Context, pool *pgxpool.Pool, docID uuid.UUID) ([][]byte, error) {
	rows, err := pool.Query(ctx,
		`SELECT update FROM collab.collab_doc_updates WHERE doc_id=$1 ORDER BY created_at ASC`,
		docID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][]byte
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// AddSnapshot persists a document snapshot for edit history.
func AddSnapshot(ctx context.Context, pool *pgxpool.Pool, docID, authorID uuid.UUID, snapshot []byte) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO collab.collab_doc_snapshots (doc_id, author_id, snapshot) VALUES ($1, $2, $3)`,
		docID, authorID, snapshot,
	)
	return err
}

// ListSnapshots returns snapshot metadata for a document (most recent first, no binary blob).
func ListSnapshots(ctx context.Context, pool *pgxpool.Pool, docID uuid.UUID) ([]Snapshot, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, doc_id, author_id, taken_at FROM collab.collab_doc_snapshots WHERE doc_id=$1 ORDER BY taken_at DESC`,
		docID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Snapshot
	for rows.Next() {
		var s Snapshot
		if err := rows.Scan(&s.ID, &s.DocID, &s.AuthorID, &s.TakenAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
