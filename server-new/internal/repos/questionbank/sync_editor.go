package questionbank

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
)

// SyncQuizRefsFromEditorJSON replaces quiz_question_refs from legacy module_quizzes JSON
// (Rust `question_bank::sync_quiz_refs_from_editor_json`).
func SyncQuizRefsFromEditorJSON(ctx context.Context, pool *pgxpool.Pool, courseID, structureItemID uuid.UUID, questions []coursemodulequiz.QuizQuestion, createdBy *uuid.UUID) error {
	if len(questions) == 0 {
		return nil
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM course.quiz_question_refs WHERE structure_item_id = $1`, structureItemID); err != nil {
		return err
	}
	sid := structureItemID.String()
	for pos, q := range questions {
		if pos > math.MaxInt16 {
			return fmt.Errorf("too many questions")
		}
		pos16 := int16(pos)
		dbType := dbQuestionTypeFromEditor(&q)
		corr := correctAnswerJSONFromQuizQuestion(&q)
		meta := map[string]string{
			"legacyQuizStructureItemId": sid,
			"legacyEditorQuestionId":    q.ID,
		}
		metaJSON, err := json.Marshal(meta)
		if err != nil {
			return err
		}
		existing, err := findLegacyQuestionID(ctx, tx, courseID, structureItemID, q.ID)
		if err != nil {
			return err
		}
		var priorOpts *json.RawMessage
		if existing != nil {
			var opts []byte
			err := tx.QueryRow(ctx, `
SELECT options FROM course.questions WHERE course_id = $1 AND id = $2
`, courseID, *existing).Scan(&opts)
			if err != nil && err != pgx.ErrNoRows {
				return err
			}
			if len(opts) > 0 {
				raw := json.RawMessage(opts)
				priorOpts = &raw
			}
		}
		merged := mergedOptionsForSync(&q, priorOpts)
		pts := float64(q.Points)
		if pts < 0 {
			pts = 0
		}
		var qUUID uuid.UUID
		if existing != nil {
			qUUID = *existing
			if err := updateQuestionRow(ctx, tx, courseID, qUUID, dbType, q.Prompt, merged, corr, nil, pts, "active", false, metaJSON, q.SrsEligible); err != nil {
				return err
			}
		} else {
			id, err := insertQuestionLegacy(ctx, tx, courseID, dbType, q.Prompt, merged, corr, nil, pts, "active", false, "legacy_json", metaJSON, createdBy, q.SrsEligible)
			if err != nil {
				return err
			}
			qUUID = id
		}
		if _, err := tx.Exec(ctx, `
INSERT INTO course.quiz_question_refs (structure_item_id, question_id, pool_id, sample_n, position)
VALUES ($1, $2, NULL, NULL, $3)
`, structureItemID, qUUID, pos16); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func dbQuestionTypeFromEditor(q *coursemodulequiz.QuizQuestion) string {
	switch q.QuestionType {
	case "true_false":
		return "true_false"
	case "fill_in_blank", "short_answer", "essay":
		return "short_answer"
	default:
		return "mc_single"
	}
}

func correctAnswerJSONFromQuizQuestion(q *coursemodulequiz.QuizQuestion) []byte {
	if q.CorrectChoiceIndex == nil {
		return nil
	}
	b, _ := json.Marshal(map[string]any{"correctChoiceIndex": *q.CorrectChoiceIndex})
	return b
}

func findLegacyQuestionID(ctx context.Context, tx pgx.Tx, courseID, structureItemID uuid.UUID, legacyEditorQuestionID string) (*uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
SELECT id FROM course.questions
WHERE course_id = $1
  AND source = 'legacy_json'
  AND metadata->>'legacyQuizStructureItemId' = $2
  AND metadata->>'legacyEditorQuestionId' = $3
LIMIT 1
`, courseID, structureItemID.String(), legacyEditorQuestionID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func insertQuestionLegacy(ctx context.Context, tx pgx.Tx, courseID uuid.UUID, questionType, stem string, options, correctAnswer json.RawMessage, explanation *string, points float64, status string, shared bool, source string, metadata json.RawMessage, createdBy *uuid.UUID, srsEligible bool) (uuid.UUID, error) {
	isPublished := status == "active"
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
INSERT INTO course.questions (
	course_id, question_type, stem, options, correct_answer, explanation,
	points, status, shared, source, metadata, created_by, is_published,
	shuffle_choices_override, srs_eligible
)
VALUES (
	$1, $2::course.question_type, $3, $4, $5, $6,
	$7, $8::course.question_status, $9, $10, $11, $12, $13, $14, $15
)
RETURNING id
`, courseID, questionType, stem, nullableRaw(options), nullableRaw(correctAnswer), explanation, points, status, shared, source, metadata, createdBy, isPublished, nil, srsEligible).Scan(&id)
	return id, err
}

func updateQuestionRow(ctx context.Context, tx pgx.Tx, courseID, questionID uuid.UUID, questionType, stem string, options, correctAnswer json.RawMessage, explanation *string, points float64, status string, shared bool, metadata json.RawMessage, srsEligible bool) error {
	_, err := tx.Exec(ctx, `
UPDATE course.questions
SET question_type = $3::course.question_type,
	stem = $4,
	options = $5,
	correct_answer = $6,
	explanation = $7,
	points = $8,
	status = $9::course.question_status,
	shared = $10,
	metadata = $11,
	srs_eligible = $12,
	is_published = CASE WHEN $9::course.question_status = 'active'::course.question_status THEN TRUE ELSE is_published END,
	updated_at = NOW()
WHERE id = $2 AND course_id = $1
`, courseID, questionID, questionType, stem, nullableRaw(options), nullableRaw(correctAnswer), explanation, points, status, shared, metadata, srsEligible)
	return err
}

func nullableRaw(r json.RawMessage) any {
	if len(r) == 0 {
		return nil
	}
	return r
}

func mergedOptionsForSync(q *coursemodulequiz.QuizQuestion, existing *json.RawMessage) json.RawMessage {
	submitted := make([]any, len(q.Choices))
	for i, c := range q.Choices {
		submitted[i] = c
	}
	submittedJSON, _ := json.Marshal(submitted)
	merged := mergeQuestionOptionsOnWrite(submittedJSON, existing)
	if len(q.ChoiceIDs) == len(q.Choices) {
		var arr []map[string]any
		if err := json.Unmarshal(merged, &arr); err == nil {
			for i := range arr {
				if i < len(q.ChoiceIDs) {
					if id, err := uuid.Parse(q.ChoiceIDs[i]); err == nil {
						arr[i]["id"] = id.String()
					}
				}
			}
			b, _ := json.Marshal(arr)
			return b
		}
	}
	return merged
}

func mergeQuestionOptionsOnWrite(submitted json.RawMessage, existingOptions *json.RawMessage) json.RawMessage {
	var newTexts []string
	var newIDs []*uuid.UUID
	var arr []any
	_ = json.Unmarshal(submitted, &arr)
	for _, el := range arr {
		raw, _ := json.Marshal(el)
		newTexts = append(newTexts, choiceTextFromJSONElement(raw))
		newIDs = append(newIDs, choiceIDFromJSONElement(raw))
	}
	var oldArr []any
	if existingOptions != nil {
		_ = json.Unmarshal(*existingOptions, &oldArr)
	}
	out := make([]map[string]any, 0, len(newTexts))
	for i, text := range newTexts {
		var id uuid.UUID
		if i < len(newIDs) && newIDs[i] != nil {
			id = *newIDs[i]
		} else if i < len(oldArr) {
			oldRaw, _ := json.Marshal(oldArr[i])
			if choiceTextFromJSONElement(oldRaw) == text {
				if parsed := choiceIDFromJSONElement(oldRaw); parsed != nil {
					id = *parsed
				} else {
					id = uuid.New()
				}
			} else {
				id = uuid.New()
			}
		} else {
			id = uuid.New()
		}
		out = append(out, map[string]any{"id": id.String(), "text": text})
	}
	b, _ := json.Marshal(out)
	return b
}
