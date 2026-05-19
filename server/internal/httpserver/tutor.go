package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/organization"
	tutorrepo "github.com/lextures/lextures/server/internal/repos/tutor"
	"github.com/lextures/lextures/server/internal/repos/userai"
	"github.com/lextures/lextures/server/internal/service/aitutor"
	"github.com/lextures/lextures/server/internal/service/openrouter"
)

const (
	maxTutorMessageChars = 2000
	maxHistoryTurns      = 20
)

// registerTutorRoutes wires up the AI tutor API (plan 6.9).
func (d Deps) registerTutorRoutes(r chi.Router) {
	r.Get("/api/v1/courses/{course_code}/tutor/conversation", d.handleGetTutorConversation())
	r.Post("/api/v1/courses/{course_code}/tutor/message", d.handlePostTutorMessage())
	r.Delete("/api/v1/courses/{course_code}/tutor/conversation", d.handleDeleteTutorConversation())
	r.Get("/api/v1/me/token-budget", d.handleGetTokenBudget())
}

// handleGetTutorConversation is GET /api/v1/courses/{course_code}/tutor/conversation.
func (d Deps) handleGetTutorConversation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		courseCode := chi.URLParam(r, "course_code")
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		c, courseID, ok := d.tutorCourseAccess(w, r, courseCode, userID)
		if !ok {
			return
		}
		if !c.AiTutorEnabled {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "AI tutor is not enabled for this course.")
			return
		}

		orgID, err := organization.OrgIDForUser(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load user org.")
			return
		}
		budget, err := tutorrepo.GetTokenBudget(ctx, d.Pool, userID, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load token budget.")
			return
		}
		conv, err := tutorrepo.GetOrCreate(ctx, d.Pool, userID, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load conversation.")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(buildConversationResponse(conv, budget))
	}
}

// handlePostTutorMessage is POST /api/v1/courses/{course_code}/tutor/message.
// Streams the tutor response via Server-Sent Events.
func (d Deps) handlePostTutorMessage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		or := d.openRouterClient()
		if or == nil || d.effectiveConfig().OpenRouterAPIKey == "" {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeAiNotConfigured, "AI provider not configured.")
			return
		}

		courseCode := chi.URLParam(r, "course_code")
		// Accept token in query param so EventSource can connect.
		userID, ok := d.meUserIDOrQueryToken(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		c, courseID, ok := d.tutorCourseAccess(w, r, courseCode, userID)
		if !ok {
			return
		}
		if !c.AiTutorEnabled {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "AI tutor is not enabled for this course.")
			return
		}

		var req struct {
			Message string `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if len([]rune(req.Message)) > maxTutorMessageChars {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput,
				fmt.Sprintf("Message too long (max %d characters).", maxTutorMessageChars))
			return
		}
		cleaned := aitutor.RedactPII(req.Message)
		if cleaned == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Message cannot be empty.")
			return
		}

		orgID, err := organization.OrgIDForUser(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load user org.")
			return
		}
		budget, err := tutorrepo.GetTokenBudget(ctx, d.Pool, userID, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load token budget.")
			return
		}
		if budget.TokensUsed >= budget.TokenLimit {
			apierr.WriteJSON(w, http.StatusPaymentRequired, "BUDGET_EXCEEDED",
				fmt.Sprintf("You have reached your monthly AI interaction limit of %d tokens. Your budget resets on the 1st of next month.", budget.TokenLimit))
			return
		}

		conv, err := tutorrepo.GetOrCreate(ctx, d.Pool, userID, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load conversation.")
			return
		}

		model, err := userai.GetCourseSetupModelID(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load model.")
			return
		}

		msgs := buildTutorMessages(c.Title, conv, cleaned)

		flusher, canFlush := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		if canFlush {
			flusher.Flush()
		}

		// Persist the student's message before calling the LLM.
		if err := tutorrepo.AppendMessage(ctx, d.Pool, conv.ID, "user", cleaned, 0); err != nil {
			tutorSSEError(w, flusher, "Failed to save your message.")
			return
		}

		fullText, streamErr := or.ChatCompletionStream(model, msgs, func(chunk string) error {
			b, _ := json.Marshal(chunk)
			_, werr := fmt.Fprintf(w, "data: {\"type\":\"content\",\"text\":%s}\n\n", string(b))
			if canFlush {
				flusher.Flush()
			}
			return werr
		})
		if streamErr != nil {
			tutorSSEError(w, flusher, "I'm having trouble right now. Please try again in a moment.")
			return
		}

		estimated := estimateTutorTokens(cleaned + fullText)
		// Non-fatal: save response and update budget; if save fails the stream already sent.
		_ = tutorrepo.AppendMessage(ctx, d.Pool, conv.ID, "assistant", fullText, estimated)
		_ = tutorrepo.AddTokens(ctx, d.Pool, userID, orgID, estimated)

		donePayload := fmt.Sprintf(`{"type":"done","conversationId":%q}`, conv.ID.String())
		_, _ = fmt.Fprintf(w, "data: %s\n\n", donePayload)
		if canFlush {
			flusher.Flush()
		}
	}
}

// handleDeleteTutorConversation is DELETE /api/v1/courses/{course_code}/tutor/conversation.
func (d Deps) handleDeleteTutorConversation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		courseCode := chi.URLParam(r, "course_code")
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		c, courseID, ok := d.tutorCourseAccess(w, r, courseCode, userID)
		if !ok {
			return
		}
		if !c.AiTutorEnabled {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "AI tutor is not enabled for this course.")
			return
		}

		if err := tutorrepo.Reset(ctx, d.Pool, userID, courseID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to reset conversation.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleGetTokenBudget is GET /api/v1/me/token-budget.
func (d Deps) handleGetTokenBudget() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		orgID, err := organization.OrgIDForUser(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load user org.")
			return
		}
		budget, err := tutorrepo.GetTokenBudget(ctx, d.Pool, userID, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load token budget.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tokensUsed":  budget.TokensUsed,
			"tokenLimit":  budget.TokenLimit,
			"periodMonth": budget.PeriodMonth.Format("2006-01"),
		})
	}
}

// tutorCourseAccess verifies the user is enrolled in the course and returns the course + UUID.
func (d Deps) tutorCourseAccess(w http.ResponseWriter, r *http.Request, courseCode string, userID uuid.UUID) (*course.CoursePublic, uuid.UUID, bool) {
	ctx := r.Context()
	hasAccess, err := enrollment.UserHasAccess(ctx, d.Pool, courseCode, userID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
		return nil, uuid.UUID{}, false
	}
	if !hasAccess {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
		return nil, uuid.UUID{}, false
	}
	c, err := course.GetPublicByCourseCode(ctx, d.Pool, courseCode)
	if err != nil || c == nil {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
		return nil, uuid.UUID{}, false
	}
	courseID, err := uuid.Parse(c.ID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course ID.")
		return nil, uuid.UUID{}, false
	}
	return c, courseID, true
}

// --- response types ---

type tutorConversationResponse struct {
	ConversationID string              `json:"conversationId"`
	Messages       []tutorrepo.Message `json:"messages"`
	TokensUsed     int                 `json:"tokensUsed"`
	TokenLimit     int                 `json:"tokenLimit"`
	PeriodMonth    string              `json:"periodMonth"`
}

func buildConversationResponse(conv tutorrepo.Conversation, budget tutorrepo.TokenBudget) tutorConversationResponse {
	msgs := conv.Messages
	if msgs == nil {
		msgs = []tutorrepo.Message{}
	}
	return tutorConversationResponse{
		ConversationID: conv.ID.String(),
		Messages:       msgs,
		TokensUsed:     budget.TokensUsed,
		TokenLimit:     budget.TokenLimit,
		PeriodMonth:    budget.PeriodMonth.Format("2006-01"),
	}
}

func buildTutorMessages(courseTitle string, conv tutorrepo.Conversation, userMessage string) []openrouter.Message {
	sys := aitutor.BuildSystemPrompt(courseTitle)
	msgs := []openrouter.Message{{Role: "system", Content: sys}}

	history := conv.Messages
	if len(history) > maxHistoryTurns*2 {
		history = history[len(history)-maxHistoryTurns*2:]
	}
	for _, m := range history {
		msgs = append(msgs, openrouter.Message{Role: m.Role, Content: m.Content})
	}
	msgs = append(msgs, openrouter.Message{Role: "user", Content: userMessage})
	return msgs
}

func estimateTutorTokens(text string) int {
	// Rough estimate: 1 token ≈ 4 chars.
	n := len(text)/4 + 1
	if n < 1 {
		return 1
	}
	return n
}

func tutorSSEError(w http.ResponseWriter, flusher http.Flusher, msg string) {
	b, _ := json.Marshal(msg)
	_, _ = fmt.Fprintf(w, "data: {\"type\":\"error\",\"message\":%s}\n\n", string(b))
	if flusher != nil {
		flusher.Flush()
	}
}
