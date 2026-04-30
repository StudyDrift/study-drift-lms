package coursemodulesurveys

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/models/coursemodulesurvey"
)

type CourseItemSurveyRow struct {
	ID            uuid.UUID
	CourseID      uuid.UUID
	Title         string
	Description   string
	AnonymityMode string
	OpensAt       *time.Time
	ClosesAt      *time.Time
	QuestionsJSON []byte
	UpdatedAt     time.Time
}

func InsertEmptyForItem(ctx context.Context, tx pgx.Tx, structureItemID uuid.UUID) error {
	if tx == nil {
		return errors.New("db tx is nil")
	}
	_, err := tx.Exec(ctx, `
INSERT INTO course.module_surveys (structure_item_id, description, anonymity_mode, questions_json, updated_at)
VALUES ($1, '', 'identified', '[]'::jsonb, NOW())
`, structureItemID)
	return err
}

func ListForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]coursemodulesurvey.SurveyResponse, error) {
	rows, err := pool.Query(ctx, `
SELECT c.id, c.course_id, c.title, s.description, s.anonymity_mode::text, s.opens_at, s.closes_at, s.questions_json, s.updated_at
FROM course.course_structure_items c
INNER JOIN course.module_surveys s ON s.structure_item_id = c.id
WHERE c.course_id = $1 AND c.kind = 'survey'
ORDER BY c.sort_order, c.created_at
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]coursemodulesurvey.SurveyResponse, 0)
	for rows.Next() {
		r, err := scanSurveyRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, mapRow(r))
	}
	return out, rows.Err()
}

func GetForItem(ctx context.Context, pool *pgxpool.Pool, itemID uuid.UUID) (*coursemodulesurvey.SurveyResponse, error) {
	row := pool.QueryRow(ctx, `
SELECT c.id, c.course_id, c.title, s.description, s.anonymity_mode::text, s.opens_at, s.closes_at, s.questions_json, s.updated_at
FROM course.course_structure_items c
INNER JOIN course.module_surveys s ON s.structure_item_id = c.id
WHERE c.id = $1 AND c.kind = 'survey'
`, itemID)
	r, err := scanSurveyRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s := mapRow(r)
	return &s, nil
}

func UpdateSurvey(ctx context.Context, pool *pgxpool.Pool, itemID uuid.UUID, title, description, anonymityMode *string, opensAt, closesAt *time.Time, questions *[]coursemodulesurvey.SurveyQuestion) (*coursemodulesurvey.SurveyResponse, error) {
	if title != nil {
		if _, err := pool.Exec(ctx, `
UPDATE course.course_structure_items
SET title = $2, updated_at = NOW()
WHERE id = $1 AND kind = 'survey'
`, itemID, *title); err != nil {
			return nil, err
		}
	}
	var qPayload any
	if questions != nil {
		raw, err := json.Marshal(*questions)
		if err != nil {
			return nil, err
		}
		qPayload = raw
	}
	if _, err := pool.Exec(ctx, `
UPDATE course.module_surveys AS s
SET description = COALESCE($2, description),
    anonymity_mode = COALESCE($3::course.survey_anonymity, anonymity_mode),
    opens_at = COALESCE($4, opens_at),
    closes_at = COALESCE($5, closes_at),
    questions_json = COALESCE($6, questions_json),
    settings_version = CASE WHEN $6::jsonb IS NOT NULL THEN s.settings_version + 1 ELSE s.settings_version END,
    updated_at = NOW()
WHERE structure_item_id = $1
`, itemID, description, anonymityMode, opensAt, closesAt, qPayload); err != nil {
		return nil, err
	}
	return GetForItem(ctx, pool, itemID)
}

func SubmissionHash(userID, surveyItemID uuid.UUID) string {
	h := sha256.New()
	h.Write(userID[:])
	h.Write(surveyItemID[:])
	return hex.EncodeToString(h.Sum(nil))
}

func SubmitResponse(ctx context.Context, pool *pgxpool.Pool, itemID, userID uuid.UUID, answers json.RawMessage) (open bool, alreadySubmitted bool, err error) {
	var mode string
	var opensAt *time.Time
	var closesAt *time.Time
	if err = pool.QueryRow(ctx, `
SELECT anonymity_mode::text, opens_at, closes_at
FROM course.module_surveys
WHERE structure_item_id = $1
`, itemID).Scan(&mode, &opensAt, &closesAt); errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil
	} else if err != nil {
		return false, false, err
	}
	now := time.Now().UTC()
	if (opensAt != nil && now.Before(*opensAt)) || (closesAt != nil && now.After(*closesAt)) {
		return false, false, nil
	}
	hash := SubmissionHash(userID, itemID)
	var storedUserID *uuid.UUID
	if mode != "anonymous" {
		storedUserID = &userID
	}
	tag, err := pool.Exec(ctx, `
INSERT INTO course.module_survey_responses (structure_item_id, user_id, submission_hash, answers_json)
VALUES ($1, $2, $3, $4)
ON CONFLICT (structure_item_id, submission_hash) DO NOTHING
`, itemID, storedUserID, hash, answers)
	if err != nil {
		return false, false, err
	}
	inserted := tag.RowsAffected() > 0
	return true, !inserted, nil
}

// AggregateResults is parity with `course_module_surveys::aggregate_results`.
func AggregateResults(ctx context.Context, pool *pgxpool.Pool, itemID uuid.UUID) (int64, []coursemodulesurvey.SurveyQuestionResult, error) {
	survey, err := GetForItem(ctx, pool, itemID)
	if err != nil {
		return 0, nil, err
	}
	if survey == nil {
		return 0, nil, nil
	}
	rows, err := pool.Query(ctx, `
SELECT answers_json
FROM course.module_survey_responses
WHERE structure_item_id = $1
`, itemID)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	var responses []json.RawMessage
	for rows.Next() {
		var a json.RawMessage
		if err := rows.Scan(&a); err != nil {
			return 0, nil, err
		}
		responses = append(responses, a)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}
	out := make([]coursemodulesurvey.SurveyQuestionResult, 0, len(survey.Questions))
	for _, q := range survey.Questions {
		var count int64
		var numericSum float64
		var numericCount int64
		dist := make(map[string]int64)
		for _, raw := range responses {
			var m map[string]json.RawMessage
			if err := json.Unmarshal(raw, &m); err != nil {
				continue
			}
			v, ok := m[q.ID]
			if !ok {
				continue
			}
			count++
			var n float64
			if err := json.Unmarshal(v, &n); err == nil && !math.IsNaN(n) {
				numericSum += n
				numericCount++
				key := fmt.Sprintf("%d", int64(n))
				dist[key]++
				continue
			}
			var s string
			if err := json.Unmarshal(v, &s); err == nil {
				dist[s]++
			}
		}
		var mean *float64
		if numericCount > 0 {
			m := numericSum / float64(numericCount)
			mean = &m
		}
		distJSON, err := json.Marshal(dist)
		if err != nil {
			return 0, nil, err
		}
		out = append(out, coursemodulesurvey.SurveyQuestionResult{
			QuestionID:    q.ID,
			Subtype:       q.Subtype,
			ResponseCount: count,
			Mean:          mean,
			Distribution:  distJSON,
		})
	}
	return int64(len(responses)), out, nil
}

func scanSurveyRow(scanner interface{ Scan(...any) error }) (CourseItemSurveyRow, error) {
	var r CourseItemSurveyRow
	err := scanner.Scan(&r.ID, &r.CourseID, &r.Title, &r.Description, &r.AnonymityMode, &r.OpensAt, &r.ClosesAt, &r.QuestionsJSON, &r.UpdatedAt)
	return r, err
}

func mapRow(row CourseItemSurveyRow) coursemodulesurvey.SurveyResponse {
	questions := make([]coursemodulesurvey.SurveyQuestion, 0)
	_ = json.Unmarshal(row.QuestionsJSON, &questions)
	return coursemodulesurvey.SurveyResponse{
		ID:            row.ID,
		CourseID:      row.CourseID,
		Title:         row.Title,
		Description:   row.Description,
		AnonymityMode: row.AnonymityMode,
		OpensAt:       row.OpensAt,
		ClosesAt:      row.ClosesAt,
		Questions:     questions,
		UpdatedAt:     row.UpdatedAt,
	}
}
