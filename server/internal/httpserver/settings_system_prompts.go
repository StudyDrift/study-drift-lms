package httpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/systemprompts"
)

const maxSystemPromptContent = 500_000

// handleListSystemPrompts is GET /api/v1/settings/system-prompts
func (d Deps) handleListSystemPrompts() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		rows, err := systemprompts.ListAll(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load system prompts.")
			return
		}
		prompts := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			prompts = append(prompts, map[string]any{
				"key":       row.Key,
				"label":     row.Label,
				"content":   row.Content,
				"updatedAt": row.UpdatedAt.UTC().Format(time.RFC3339Nano),
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"prompts": prompts})
	}
}

type putSystemPromptBody struct {
	Content string `json:"content"`
}

// handlePutSystemPrompt is PUT /api/v1/settings/system-prompts/{key}
func (d Deps) handlePutSystemPrompt() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		uid, ok := d.adminRbacUser(w, r)
		if !ok {
			return
		}
		key := strings.TrimSpace(chi.URLParam(r, "key"))
		if !validSystemPromptKey(key) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid prompt key.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var in putSystemPromptBody
		if err := json.Unmarshal(b, &in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		content := strings.TrimSpace(in.Content)
		if content == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Prompt content is required.")
			return
		}
		if len(content) > maxSystemPromptContent {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Prompt is too long.")
			return
		}
		row, err := systemprompts.Update(r.Context(), d.Pool, key, content, uid)
		if err != nil {
			if err == pgx.ErrNoRows {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Prompt not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save system prompt.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"key":       row.Key,
			"label":     row.Label,
			"content":   row.Content,
			"updatedAt": row.UpdatedAt.UTC().Format(time.RFC3339Nano),
		})
	}
}

func validSystemPromptKey(key string) bool {
	if key == "" {
		return false
	}
	for i := 0; i < len(key); i++ {
		c := key[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' {
			continue
		}
		return false
	}
	return true
}
