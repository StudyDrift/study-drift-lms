// Package tutor provides persistence for AI tutor conversations and token budgets (plan 6.9).
package tutor

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Message is one chat turn stored in the JSONB messages array.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Conversation is a row from course.tutor_conversations.
type Conversation struct {
	ID         uuid.UUID
	StudentID  uuid.UUID
	CourseID   uuid.UUID
	Messages   []Message
	TokensUsed int
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// TokenBudget is one row from course.student_token_budgets.
type TokenBudget struct {
	StudentID   uuid.UUID
	OrgID       uuid.UUID
	PeriodMonth time.Time
	TokensUsed  int
	TokenLimit  int
}

// GetOrCreate returns the existing conversation for the student+course pair, or creates one.
func GetOrCreate(ctx context.Context, pool *pgxpool.Pool, studentID, courseID uuid.UUID) (Conversation, error) {
	const upsert = `
		INSERT INTO course.tutor_conversations (student_id, course_id, messages, tokens_used)
		VALUES ($1, $2, '[]'::jsonb, 0)
		ON CONFLICT (student_id, course_id) DO UPDATE
		  SET updated_at = course.tutor_conversations.updated_at
		RETURNING id, student_id, course_id, messages, tokens_used, created_at, updated_at
	`
	return scan(pool.QueryRow(ctx, upsert, studentID, courseID))
}

// AppendMessage appends a role/content pair and increments tokens_used in a single UPDATE.
func AppendMessage(ctx context.Context, pool *pgxpool.Pool, convID uuid.UUID, role, content string, tokensUsed int) error {
	msg := Message{Role: role, Content: content}
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	const q = `
		UPDATE course.tutor_conversations
		SET messages = messages || $2::jsonb,
		    tokens_used = tokens_used + $3,
		    updated_at = now()
		WHERE id = $1
	`
	tag, err := pool.Exec(ctx, q, convID, json.RawMessage("["+string(b)+"]"), tokensUsed)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("tutor: conversation not found")
	}
	return nil
}

// Reset clears the messages and resets tokens_used on a conversation.
func Reset(ctx context.Context, pool *pgxpool.Pool, studentID, courseID uuid.UUID) error {
	const q = `
		UPDATE course.tutor_conversations
		SET messages = '[]'::jsonb, tokens_used = 0, updated_at = now()
		WHERE student_id = $1 AND course_id = $2
	`
	_, err := pool.Exec(ctx, q, studentID, courseID)
	return err
}

// GetTokenBudget returns the current-month budget row, creating it if missing.
func GetTokenBudget(ctx context.Context, pool *pgxpool.Pool, studentID, orgID uuid.UUID) (TokenBudget, error) {
	month := firstOfMonth(time.Now().UTC())
	const upsert = `
		INSERT INTO course.student_token_budgets (student_id, org_id, period_month, tokens_used, token_limit)
		VALUES ($1, $2, $3, 0, 50000)
		ON CONFLICT (student_id, period_month) DO UPDATE
		  SET org_id = EXCLUDED.org_id
		RETURNING student_id, org_id, period_month, tokens_used, token_limit
	`
	row := pool.QueryRow(ctx, upsert, studentID, orgID, month)
	var b TokenBudget
	var sid, oid uuid.UUID
	if err := row.Scan(&sid, &oid, &b.PeriodMonth, &b.TokensUsed, &b.TokenLimit); err != nil {
		return TokenBudget{}, err
	}
	b.StudentID = sid
	b.OrgID = oid
	return b, nil
}

// AddTokens adds delta tokens to the current-month budget row.
func AddTokens(ctx context.Context, pool *pgxpool.Pool, studentID, orgID uuid.UUID, delta int) error {
	month := firstOfMonth(time.Now().UTC())
	const q = `
		INSERT INTO course.student_token_budgets (student_id, org_id, period_month, tokens_used, token_limit)
		VALUES ($1, $2, $3, $4, 50000)
		ON CONFLICT (student_id, period_month) DO UPDATE
		  SET tokens_used = course.student_token_budgets.tokens_used + EXCLUDED.tokens_used
	`
	_, err := pool.Exec(ctx, q, studentID, orgID, month, delta)
	return err
}

func scan(row pgx.Row) (Conversation, error) {
	var c Conversation
	var msgs []byte
	if err := row.Scan(&c.ID, &c.StudentID, &c.CourseID, &msgs, &c.TokensUsed, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return Conversation{}, err
	}
	if len(msgs) > 0 && string(msgs) != "null" {
		if err := json.Unmarshal(msgs, &c.Messages); err != nil {
			return Conversation{}, err
		}
	}
	if c.Messages == nil {
		c.Messages = []Message{}
	}
	return c, nil
}

func firstOfMonth(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}
