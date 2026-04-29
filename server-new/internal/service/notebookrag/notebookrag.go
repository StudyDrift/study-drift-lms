// Package notebookrag implements student notebook RAG: lexical chunking + OpenRouter (parity with Rust student_notebook_rag_ai).
package notebookrag

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/repos/userai"
	"github.com/lextures/lextures/server-new/internal/service/openrouter"
)

const (
	maxQuestionChars         = 2000
	maxNotebooks             = 48
	maxMarkdownPerNotebook   = 100_000
	maxTotalMarkdown         = 320_000
	chunkCharTarget          = 1100
	chunkCharStride          = 720
	maxChunksInPrompt        = 14
	sourceExcerptChars         = 220
	emptyNotebooksMsg          = "Your notebooks look empty from the server’s perspective—there were no text chunks to search. Try again after saving notes in a course notebook."
)

const systemPrompt = `You answer questions using only the student's private course notebook excerpts provided below.

Rules:
- Ground every factual claim in the excerpts. If the excerpts do not contain enough information, say clearly that their notes do not cover it and suggest they add notes or check the relevant course.
- When you reference a course, name it naturally and include its course code in parentheses (e.g. "Introduction to Lextures (C-892CB7)").
- Respond in Markdown (headings optional, use bullet lists when helpful). Do not wrap the entire answer in a single fenced code block.
- Do not invent assignments, deadlines, grades, or instructor statements that are not in the excerpts.`

// DocInput is one course notebook from the client (camelCase JSON in API).
type DocInput struct {
	CourseCode  string
	CourseTitle string
	Markdown    string
}

// Source is a citation line returned to the client.
type Source struct {
	CourseCode  string `json:"courseCode"`
	CourseTitle string `json:"courseTitle"`
	Excerpt     string `json:"excerpt"`
}

// Response is the JSON body for POST /api/v1/me/notebooks/query.
type Response struct {
	AnswerMarkdown string   `json:"answerMarkdown"`
	Sources        []Source `json:"sources"`
}

// FilterDocs trims and drops empty items (parity with me.rs post_notebooks_query).
func FilterDocs(raw []DocInput) []DocInput {
	out := make([]DocInput, 0, len(raw))
	for _, mut := range raw {
		mut.CourseCode = strings.TrimSpace(mut.CourseCode)
		mut.CourseTitle = strings.TrimSpace(mut.CourseTitle)
		mut.Markdown = strings.TrimSpace(mut.Markdown)
		if mut.CourseCode == "" || mut.Markdown == "" {
			continue
		}
		if mut.CourseTitle == "" {
			mut.CourseTitle = mut.CourseCode
		}
		out = append(out, mut)
	}
	return out
}

// ValidationError is a client error (400 INVALID_INPUT).
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

// IsValidationError reports whether err is a request validation error (400).
func IsValidationError(err error) bool {
	var v *ValidationError
	return err != nil && errors.As(err, &v)
}

// GenerationError is a failed or empty model response (502).
type GenerationError struct{ Message string }

func (e *GenerationError) Error() string { return e.Message }

// IsGenerationError reports whether err should map to 502 AI_GENERATION_FAILED.
func IsGenerationError(err error) bool {
	var g *GenerationError
	return err != nil && errors.As(err, &g)
}

// ValidateRequest checks size limits.
func ValidateRequest(question string, notebooks []DocInput) error {
	q := strings.TrimSpace(question)
	if q == "" {
		return &ValidationError{"Ask a question about your notes."}
	}
	if utf8.RuneCountInString(q) > maxQuestionChars {
		return &ValidationError{fmt.Sprintf("Question is too long (max %d characters).", maxQuestionChars)}
	}
	if len(notebooks) == 0 {
		return &ValidationError{"Send at least one notebook with content."}
	}
	if len(notebooks) > maxNotebooks {
		return &ValidationError{fmt.Sprintf("Too many notebooks in one request (max %d).", maxNotebooks)}
	}
	total := 0
	for _, nb := range notebooks {
		n := utf8.RuneCountInString(nb.Markdown)
		if n > maxMarkdownPerNotebook {
			return &ValidationError{fmt.Sprintf("Notebook %s exceeds the maximum size.", nb.CourseCode)}
		}
		total += n
	}
	if total > maxTotalMarkdown {
		return &ValidationError{"Combined notebook content is too large for one question."}
	}
	return nil
}

type scoredChunk struct {
	courseCode, courseTitle, text string
	score                         uint32
}

func tokenize(s string) []string {
	// Parity with Rust: alphanumeric Unicode chars form tokens (length ≥ 2), lowercased.
	var out []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() >= 2 {
			out = append(out, cur.String())
		}
		cur.Reset()
	}
	for _, ch := range s {
		if unicode.IsLetter(ch) || unicode.IsNumber(ch) {
			cur.WriteRune(unicode.ToLower(ch))
		} else {
			flush()
		}
	}
	flush()
	return out
}

func tokenCounts(tokens []string) map[string]uint32 {
	m := make(map[string]uint32)
	for _, t := range tokens {
		m[t]++
	}
	return m
}

func coarseChunks(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	runes := []rune(text)
	var out []string
	i := 0
	for i < len(runes) {
		end := i + chunkCharTarget
		if end > len(runes) {
			end = len(runes)
		}
		chunk := strings.TrimSpace(string(runes[i:end]))
		if chunk != "" {
			out = append(out, chunk)
		}
		if end == len(runes) {
			break
		}
		i += chunkCharStride
	}
	return out
}

func lexicalScore(queryTokens []string, chunk, courseCode, courseTitle string) uint32 {
	qCounts := tokenCounts(queryTokens)
	if len(qCounts) == 0 {
		return 0
	}
	cTokens := tokenize(chunk)
	cCounts := tokenCounts(cTokens)
	var s uint32
	for term, qn := range qCounts {
		if cn, ok := cCounts[term]; ok {
			var qf uint32
			if qn > 4 {
				qf = 4
			} else {
				qf = qn
			}
			var cf uint32
			if cn > 6 {
				cf = 6
			} else {
				cf = cn
			}
			s += qf * cf
		}
	}
	for _, term := range tokenize(courseTitle) {
		if _, ok := qCounts[term]; ok {
			s += 2
		}
	}
	for _, term := range tokenize(courseCode) {
		if _, ok := qCounts[term]; ok {
			s += 3
		}
	}
	return s
}

func retrieveChunks(question string, notebooks []DocInput) []scoredChunk {
	queryTokens := tokenize(question)
	var candidates []scoredChunk
	for i := range notebooks {
		nb := &notebooks[i]
		for _, ch := range coarseChunks(nb.Markdown) {
			score := lexicalScore(queryTokens, ch, nb.CourseCode, nb.CourseTitle)
			candidates = append(candidates, scoredChunk{
				courseCode:  nb.CourseCode,
				courseTitle: nb.CourseTitle,
				text:        ch,
				score:       score,
			})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score > candidates[j].score
		}
		return len(candidates[i].text) < len(candidates[j].text)
	})
	if len(candidates) > maxChunksInPrompt {
		candidates = candidates[:maxChunksInPrompt]
	}
	return candidates
}

func excerpt(s string) string {
	t := strings.ReplaceAll(s, "\n", " ")
	t = strings.ReplaceAll(t, "\r", "")
	t = strings.Join(strings.Fields(t), " ")
	if utf8.RuneCountInString(t) <= sourceExcerptChars {
		return t
	}
	rs := []rune(t)
	if len(rs) > sourceExcerptChars-1 {
		return string(rs[:sourceExcerptChars-1]) + "…"
	}
	return t
}

func normalizeMarkdownOutput(raw string) string {
	s := strings.TrimSpace(raw)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	lines := strings.Split(s, "\n")
	if len(lines) > 0 && strings.HasPrefix(strings.TrimLeft(lines[0], " "), "```") {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "```" {
		lines = lines[:len(lines)-1]
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// Answer runs validation, retrieval, and the OpenRouter call (used by HTTP handler).
func Answer(ctx context.Context, pool *pgxpool.Pool, or *openrouter.Client, userID uuid.UUID, question string, notebooks []DocInput) (Response, error) {
	if err := ValidateRequest(question, notebooks); err != nil {
		return Response{}, err
	}
	model, err := userai.GetCourseSetupModelID(ctx, pool, userID)
	if err != nil {
		return Response{}, err
	}
	q := strings.TrimSpace(question)
	chunks := retrieveChunks(q, notebooks)
	var context strings.Builder
	for i, ch := range chunks {
		context.WriteString("\n\n--- Excerpt ")
		_, _ = fmt.Fprintf(&context, "%d", i+1)
		context.WriteString(" — ")
		context.WriteString(ch.courseTitle)
		context.WriteString(" (")
		context.WriteString(ch.courseCode)
		context.WriteString(") ---\n")
		context.WriteString(ch.text)
	}
	if strings.TrimSpace(context.String()) == "" {
		return Response{AnswerMarkdown: emptyNotebooksMsg, Sources: nil}, nil
	}
	userBody := fmt.Sprintf(
		"Student question:\n---\n%s\n---\n\nRelevant notebook excerpts (only use these as evidence):%s",
		q, context.String())
	msgs := []openrouter.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userBody},
	}
	text, err := or.ChatCompletion(model, msgs)
	if err != nil {
		return Response{}, &GenerationError{Message: err.Error()}
	}
	answer := normalizeMarkdownOutput(text)
	if answer == "" {
		return Response{}, &GenerationError{Message: "The model returned an empty response."}
	}
	sources := make([]Source, 0, len(chunks))
	for i := range chunks {
		ch := &chunks[i]
		sources = append(sources, Source{
			CourseCode:  ch.courseCode,
			CourseTitle: ch.courseTitle,
			Excerpt:     excerpt(ch.text),
		})
	}
	return Response{AnswerMarkdown: answer, Sources: sources}, nil
}
