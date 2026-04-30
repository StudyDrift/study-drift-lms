package questionbank

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/models/coursemodulequiz"
)

// QuizQuestionRefRow mirrors `server/src/repos/question_bank::QuizQuestionRefRow`.
type QuizQuestionRefRow struct {
	ID              uuid.UUID
	StructureItemID uuid.UUID
	QuestionID      *uuid.UUID
	PoolID          *uuid.UUID
	SampleN         *int32
	Position        int16
}

// QuestionEntity is a `course.questions` row (extended fields used by diagnostics / CAT and editor delivery).
type QuestionEntity struct {
	ID                     uuid.UUID
	CourseID               uuid.UUID
	QuestionType           string
	Stem                   string
	Options                json.RawMessage
	CorrectAnswer          json.RawMessage
	Explanation            *string
	Points                 float64
	Status                 string
	Shared                 bool
	Source                 string
	Metadata               json.RawMessage
	ShuffleChoicesOverride *bool
	IrtA                   *float64
	IrtB                   *float64
	IrtC                   *float64
	IrtStatus              string
	IrtSampleN             int32
	IrtCalibratedAt        *time.Time
	CreatedBy              *uuid.UUID
	CreatedAt              time.Time
	UpdatedAt              time.Time
	VersionNumber          int32
	IsPublished            bool
	SRSEligible            bool
}

// QuestionConceptTagRow pairs a bank question to a tagged concept.
type QuestionConceptTagRow struct {
	QuestionID uuid.UUID
	ConceptID  uuid.UUID
}

// ListQuizQuestionRefs returns ordered delivery refs for a quiz structure item.
func ListQuizQuestionRefs(ctx context.Context, pool *pgxpool.Pool, structureItemID uuid.UUID) ([]QuizQuestionRefRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, structure_item_id, question_id, pool_id, sample_n, position
FROM course.quiz_question_refs
WHERE structure_item_id = $1
ORDER BY position ASC, id ASC
`, structureItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []QuizQuestionRefRow
	for rows.Next() {
		var r QuizQuestionRefRow
		if err := rows.Scan(&r.ID, &r.StructureItemID, &r.QuestionID, &r.PoolID, &r.SampleN, &r.Position); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RefsUsePool is true when any ref row draws from a pool.
func RefsUsePool(refs []QuizQuestionRefRow) bool {
	for i := range refs {
		if refs[i].PoolID != nil {
			return true
		}
	}
	return false
}

func hasExtendedQuizTypes(questions []coursemodulequiz.QuizQuestion) bool {
	for i := range questions {
		switch questions[i].QuestionType {
		case "matching", "ordering", "hotspot", "numeric", "formula", "code", "file_upload", "audio_response", "video_response":
			return true
		}
	}
	return false
}

func editorQuestionTypeFromDB(db string) string {
	switch db {
	case "true_false":
		return "true_false"
	case "short_answer":
		return "short_answer"
	case "mc_multiple":
		return "multiple_choice"
	default:
		return "multiple_choice"
	}
}

func choiceTextFromJSONElement(raw json.RawMessage) string {
	var v any
	if len(raw) == 0 {
		return ""
	}
	_ = json.Unmarshal(raw, &v)
	if s, ok := v.(string); ok {
		return s
	}
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	if s, ok := m["text"].(string); ok {
		return s
	}
	if s, ok := m["label"].(string); ok {
		return s
	}
	return ""
}

func choiceIDFromJSONElement(raw json.RawMessage) *uuid.UUID {
	var v map[string]any
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	s, _ := v["id"].(string)
	if s == "" {
		return nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return nil
	}
	return &id
}

func extractChoiceLinesFromOptionsJSON(opts json.RawMessage) (texts []string, ids []*uuid.UUID) {
	var arr []json.RawMessage
	if len(opts) == 0 {
		return nil, nil
	}
	if err := json.Unmarshal(opts, &arr); err != nil {
		return nil, nil
	}
	for _, el := range arr {
		texts = append(texts, choiceTextFromJSONElement(el))
		ids = append(ids, choiceIDFromJSONElement(el))
	}
	return texts, ids
}

// QuizQuestionFromEntity maps a bank row to the LMS editor question shape.
func QuizQuestionFromEntity(e *QuestionEntity) (coursemodulequiz.QuizQuestion, error) {
	if e == nil {
		return coursemodulequiz.QuizQuestion{}, errors.New("nil entity")
	}
	texts, optIDs := extractChoiceLinesFromOptionsJSON(e.Options)
	var choiceIDs []string
	allIDs := true
	for _, id := range optIDs {
		if id == nil {
			allIDs = false
			break
		}
		choiceIDs = append(choiceIDs, id.String())
	}
	if !allIDs {
		choiceIDs = nil
	}
	var correctIdx *uint
	if len(e.CorrectAnswer) > 0 {
		var corr struct {
			CorrectChoiceIndex *uint `json:"correctChoiceIndex"`
		}
		_ = json.Unmarshal(e.CorrectAnswer, &corr)
		correctIdx = corr.CorrectChoiceIndex
	}
	pts := int32(math.Round(e.Points))
	q := coursemodulequiz.QuizQuestion{
		ID:                 e.ID.String(),
		Prompt:             e.Stem,
		QuestionType:       editorQuestionTypeFromDB(e.QuestionType),
		Choices:            texts,
		ChoiceIDs:          choiceIDs,
		TypeConfig:         json.RawMessage(`{}`),
		CorrectChoiceIndex: correctIdx,
		MultipleAnswer:     e.QuestionType == "mc_multiple",
		AnswerWithImage:    false,
		Required:           true,
		Points:             pts,
		EstimatedMinutes:   2,
		ConceptIDs:         nil,
		SrsEligible:        e.SRSEligible,
	}
	return q, nil
}

func loadQuizQuestionsMap(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]QuestionEntity, error) {
	if len(ids) == 0 {
		return map[uuid.UUID]QuestionEntity{}, nil
	}
	rows, err := pool.Query(ctx, `
SELECT id, course_id, question_type::text, stem, options, correct_answer,
       points::float8, version_number, srs_eligible
FROM course.questions
WHERE course_id = $1 AND id = ANY($2::uuid[])
`, courseID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]QuestionEntity)
	for rows.Next() {
		var e QuestionEntity
		if err := rows.Scan(&e.ID, &e.CourseID, &e.QuestionType, &e.Stem, &e.Options, &e.CorrectAnswer, &e.Points, &e.VersionNumber, &e.SRSEligible); err != nil {
			return nil, err
		}
		out[e.ID] = e
	}
	return out, rows.Err()
}

func countAttemptSelections(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM course.attempt_question_selections WHERE attempt_id = $1`, attemptID).Scan(&n)
	return n, err
}

type attemptSelectionRow struct {
	QuestionID    uuid.UUID
	VersionNumber int32
}

func listAttemptSelectionsOrdered(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID) ([]attemptSelectionRow, error) {
	rows, err := pool.Query(ctx, `
SELECT question_id, version_number FROM course.attempt_question_selections
WHERE attempt_id = $1
ORDER BY position ASC
`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []attemptSelectionRow
	for rows.Next() {
		var r attemptSelectionRow
		if err := rows.Scan(&r.QuestionID, &r.VersionNumber); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func getQuestionVersionSnapshot(ctx context.Context, pool *pgxpool.Pool, courseID, questionID uuid.UUID, version int32) (json.RawMessage, error) {
	var snap []byte
	err := pool.QueryRow(ctx, `
SELECT qv.snapshot
FROM course.question_versions qv
INNER JOIN course.questions q ON q.id = qv.question_id
WHERE qv.question_id = $1 AND q.course_id = $2 AND qv.version_number = $3
`, questionID, courseID, version).Scan(&snap)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return snap, nil
}

// snapshotQuestion matches JSON written by Rust `insert_question_version_snapshot`.
type snapshotQuestion struct {
	ID            uuid.UUID       `json:"id"`
	CourseID      uuid.UUID       `json:"course_id"`
	QuestionType  string          `json:"question_type"`
	Stem          string          `json:"stem"`
	Options       json.RawMessage `json:"options"`
	CorrectAnswer json.RawMessage `json:"correct_answer"`
	Points        float64         `json:"points"`
	VersionNumber int32           `json:"version_number"`
	SRSEligible   bool            `json:"srs_eligible"`
}

func questionEntityFromSnapshot(snap json.RawMessage) (*QuestionEntity, error) {
	var s snapshotQuestion
	if err := json.Unmarshal(snap, &s); err != nil {
		return nil, err
	}
	return &QuestionEntity{
		ID:            s.ID,
		CourseID:      s.CourseID,
		QuestionType:  s.QuestionType,
		Stem:          s.Stem,
		Options:       s.Options,
		CorrectAnswer: s.CorrectAnswer,
		Points:        s.Points,
		VersionNumber: s.VersionNumber,
		SRSEligible:   s.SRSEligible,
	}, nil
}

func quizQuestionsForAttemptSelections(ctx context.Context, pool *pgxpool.Pool, courseID, attemptID uuid.UUID) ([]coursemodulequiz.QuizQuestion, error) {
	ordered, err := listAttemptSelectionsOrdered(ctx, pool, attemptID)
	if err != nil {
		return nil, err
	}
	if len(ordered) == 0 {
		return nil, nil
	}
	ids := make([]uuid.UUID, len(ordered))
	for i := range ordered {
		ids[i] = ordered[i].QuestionID
	}
	curMap, err := loadQuizQuestionsMap(ctx, pool, courseID, ids)
	if err != nil {
		return nil, err
	}
	out := make([]coursemodulequiz.QuizQuestion, 0, len(ordered))
	for _, picked := range ordered {
		cur, ok := curMap[picked.QuestionID]
		var ent *QuestionEntity
		if ok && cur.VersionNumber == picked.VersionNumber {
			ent = &cur
		} else {
			snap, err := getQuestionVersionSnapshot(ctx, pool, courseID, picked.QuestionID, picked.VersionNumber)
			if err != nil {
				return nil, err
			}
			if len(snap) == 0 {
				return nil, fmt.Errorf("missing question version snapshot for %s@%d", picked.QuestionID, picked.VersionNumber)
			}
			e, err := questionEntityFromSnapshot(snap)
			if err != nil {
				return nil, err
			}
			ent = e
		}
		qq, err := QuizQuestionFromEntity(ent)
		if err != nil {
			return nil, err
		}
		out = append(out, qq)
	}
	return out, nil
}

// ResolveDeliveryQuestionsForGet mirrors `question_bank::resolve_delivery_questions` for GET quiz.
func ResolveDeliveryQuestionsForGet(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID uuid.UUID,
	structureItemID uuid.UUID,
	bankEnabled bool,
	questions []coursemodulequiz.QuizQuestion,
	attemptID *uuid.UUID,
	isInstructor bool,
) ([]coursemodulequiz.QuizQuestion, bool, error) {
	refs, err := ListQuizQuestionRefs(ctx, pool, structureItemID)
	if err != nil {
		return nil, false, err
	}
	if hasExtendedQuizTypes(questions) {
		return cloneQuestions(questions), false, nil
	}
	if !bankEnabled || len(refs) == 0 {
		return cloneQuestions(questions), false, nil
	}
	if isInstructor {
		return cloneQuestions(questions), RefsUsePool(refs), nil
	}
	if attemptID != nil {
		n, err := countAttemptSelections(ctx, pool, *attemptID)
		if err != nil {
			return nil, false, err
		}
		if n > 0 {
			qs, err := quizQuestionsForAttemptSelections(ctx, pool, courseID, *attemptID)
			if err != nil {
				return nil, false, err
			}
			return qs, true, nil
		}
	}
	if RefsUsePool(refs) {
		return []coursemodulequiz.QuizQuestion{}, true, nil
	}
	var qids []uuid.UUID
	for i := range refs {
		if refs[i].QuestionID != nil {
			qids = append(qids, *refs[i].QuestionID)
		}
	}
	m, err := loadQuizQuestionsMap(ctx, pool, courseID, qids)
	if err != nil {
		return nil, false, err
	}
	var out []coursemodulequiz.QuizQuestion
	for i := range refs {
		if refs[i].QuestionID == nil {
			continue
		}
		row, ok := m[*refs[i].QuestionID]
		if !ok {
			return nil, false, fmt.Errorf("question bank data is missing for question %s", refs[i].QuestionID)
		}
		qq, err := QuizQuestionFromEntity(&row)
		if err != nil {
			return nil, false, err
		}
		out = append(out, qq)
	}
	return out, false, nil
}

func cloneQuestions(qs []coursemodulequiz.QuizQuestion) []coursemodulequiz.QuizQuestion {
	if len(qs) == 0 {
		return nil
	}
	out := make([]coursemodulequiz.QuizQuestion, len(qs))
	copy(out, qs)
	for i := range out {
		if len(qs[i].Choices) > 0 {
			out[i].Choices = append([]string(nil), qs[i].Choices...)
		}
		if len(qs[i].ChoiceIDs) > 0 {
			out[i].ChoiceIDs = append([]string(nil), qs[i].ChoiceIDs...)
		}
		if len(qs[i].ConceptIDs) > 0 {
			out[i].ConceptIDs = append([]string(nil), qs[i].ConceptIDs...)
		}
		if len(qs[i].TypeConfig) > 0 {
			out[i].TypeConfig = append(json.RawMessage(nil), qs[i].TypeConfig...)
		}
	}
	return out
}

// GetQuestionForCourse loads one question scoped to a course (Rust `get_question`).
func GetQuestionForCourse(ctx context.Context, pool *pgxpool.Pool, courseID, questionID uuid.UUID) (*QuestionEntity, error) {
	var e QuestionEntity
	err := pool.QueryRow(ctx, `
SELECT id, course_id, question_type::text, stem, options, correct_answer, explanation,
       points::float8, status::text, shared, source, metadata, shuffle_choices_override,
       irt_a::float8, irt_b::float8, irt_c::float8,
       irt_status::text, irt_sample_n, irt_calibrated_at,
       created_by, created_at, updated_at,
       version_number, is_published, srs_eligible
FROM course.questions
WHERE id = $2 AND course_id = $1
`, courseID, questionID).Scan(
		&e.ID, &e.CourseID, &e.QuestionType, &e.Stem, &e.Options, &e.CorrectAnswer, &e.Explanation,
		&e.Points, &e.Status, &e.Shared, &e.Source, &e.Metadata, &e.ShuffleChoicesOverride,
		&e.IrtA, &e.IrtB, &e.IrtC, &e.IrtStatus, &e.IrtSampleN, &e.IrtCalibratedAt,
		&e.CreatedBy, &e.CreatedAt, &e.UpdatedAt,
		&e.VersionNumber, &e.IsPublished, &e.SRSEligible,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &e, nil
}

// ListActiveDiagnosticQuestionIDs returns active MC/TF items tagged to any diagnostic concept (Rust `list_active_diagnostic_question_ids`).
func ListActiveDiagnosticQuestionIDs(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, conceptIDs []uuid.UUID) ([]uuid.UUID, error) {
	if len(conceptIDs) == 0 {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
SELECT DISTINCT q.id
FROM course.questions q
WHERE q.course_id = $1
  AND q.status = 'active'::course.question_status
  AND q.question_type::text IN ('mc_single', 'mc_multiple', 'true_false')
  AND (
    EXISTS (
      SELECT 1 FROM course.concept_question_tags t
      WHERE t.question_id = q.id AND t.concept_id = ANY($2)
    )
    OR EXISTS (
      SELECT 1
      FROM unnest($2::uuid[]) AS c(concept_id)
      WHERE COALESCE(q.metadata->'conceptIds', '[]'::jsonb)
        @> jsonb_build_array(to_jsonb(c.concept_id::text))
    )
  )
`, courseID, conceptIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListConceptTagsForQuestions returns tag rows restricted to the given concept id set.
func ListConceptTagsForQuestions(ctx context.Context, pool *pgxpool.Pool, questionIDs, conceptIDs []uuid.UUID) ([]QuestionConceptTagRow, error) {
	if len(questionIDs) == 0 || len(conceptIDs) == 0 {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
SELECT question_id, concept_id
FROM course.concept_question_tags
WHERE question_id = ANY($1) AND concept_id = ANY($2)
`, questionIDs, conceptIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []QuestionConceptTagRow
	for rows.Next() {
		var r QuestionConceptTagRow
		if err := rows.Scan(&r.QuestionID, &r.ConceptID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListQuestionConceptsInSet returns concept ids from tags intersecting diagnostic concepts.
func ListQuestionConceptsInSet(ctx context.Context, pool *pgxpool.Pool, questionID uuid.UUID, conceptIDs []uuid.UUID) ([]uuid.UUID, error) {
	if len(conceptIDs) == 0 {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
SELECT t.concept_id
FROM course.concept_question_tags t
WHERE t.question_id = $1 AND t.concept_id = ANY($2)
`, questionID, conceptIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
