package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/translation"
	"github.com/lextures/lextures/server/internal/service/openrouter"
)

const translationProvider = "openrouter"

var allowedContentTypes = map[string]bool{
	"feed_post":        true,
	"discussion_post":  true,
	"inbox_message":    true,
	"announcement":     true,
}

type translateRequest struct {
	ContentType string `json:"content_type"`
	ContentID   string `json:"content_id"`
	TargetLang  string `json:"target_lang"`
	Text        string `json:"text"`
}

type translateResponse struct {
	Translated string `json:"translated"`
	SourceLang string `json:"source_lang"`
	Cached     bool   `json:"cached"`
}

// registerTranslationRoutes wires up the translation API (plan 6.10).
func (d Deps) registerTranslationRoutes(r chi.Router) {
	r.Post("/api/v1/translate", d.handleTranslate())
}

// handleTranslate is POST /api/v1/translate.
// Request: { content_type, content_id, target_lang, text }
// Response: { translated, source_lang, cached }
func (d Deps) handleTranslate() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, ok := d.meUserID(w, r)
		if !ok {
			return
		}

		var req translateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}

		req.ContentType = strings.TrimSpace(req.ContentType)
		req.ContentID = strings.TrimSpace(req.ContentID)
		req.TargetLang = strings.TrimSpace(req.TargetLang)
		req.Text = strings.TrimSpace(req.Text)

		if !allowedContentTypes[req.ContentType] {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid content_type.")
			return
		}
		contentID, err := uuid.Parse(req.ContentID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid content_id.")
			return
		}
		if req.TargetLang == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "target_lang is required.")
			return
		}
		if req.Text == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "text is required.")
			return
		}

		ctx := r.Context()

		cached, err := translation.Lookup(ctx, d.Pool, req.ContentType, contentID, req.TargetLang)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check translation cache.")
			return
		}
		if cached != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(translateResponse{
				Translated: cached.Translated,
				SourceLang: cached.SourceLang,
				Cached:     true,
			})
			return
		}

		or := d.openRouterClient()
		if or == nil || d.effectiveConfig().OpenRouterAPIKey == "" {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeAiNotConfigured, "Translation provider not configured.")
			return
		}

		translated, sourceLang, err := callLLMTranslation(or, req.Text, req.TargetLang)
		if err != nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "Translation temporarily unavailable.")
			return
		}

		_ = translation.Store(ctx, d.Pool, req.ContentType, contentID, sourceLang, req.TargetLang, translated, translationProvider)

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(translateResponse{
			Translated: translated,
			SourceLang: sourceLang,
			Cached:     false,
		})
	}
}

// callLLMTranslation sends a translation request to the LLM and returns (translated, sourceLang, error).
func callLLMTranslation(or *openrouter.Client, text, targetLang string) (string, string, error) {
	langName := langCodeToName(targetLang)
	prompt := fmt.Sprintf(
		"Detect the source language of the following text and translate it to %s. "+
			"Respond with JSON only in this exact format, no commentary: "+
			`{"source_lang":"<BCP47 code>","translated":"<translation>"}`,
		langName,
	)
	messages := []openrouter.Message{
		{Role: "system", Content: prompt},
		{Role: "user", Content: text},
	}

	cfg, err := or.ChatCompletion("openai/gpt-4o-mini", messages)
	if err != nil {
		return "", "", fmt.Errorf("llm call failed: %w", err)
	}

	var result struct {
		SourceLang string `json:"source_lang"`
		Translated string `json:"translated"`
	}
	if err := json.Unmarshal([]byte(cfg), &result); err != nil {
		// If LLM didn't produce valid JSON, treat entire response as the translation.
		return strings.TrimSpace(cfg), "und", nil
	}
	if result.SourceLang == "" {
		result.SourceLang = "und"
	}
	return result.Translated, result.SourceLang, nil
}

// langCodeToName converts a BCP 47 language code to a human-readable name for the prompt.
func langCodeToName(code string) string {
	names := map[string]string{
		"en":    "English",
		"es":    "Spanish",
		"fr":    "French",
		"de":    "German",
		"it":    "Italian",
		"pt":    "Portuguese",
		"zh":    "Chinese (Simplified)",
		"zh-tw": "Chinese (Traditional)",
		"ja":    "Japanese",
		"ko":    "Korean",
		"ar":    "Arabic",
		"ru":    "Russian",
		"hi":    "Hindi",
		"bn":    "Bengali",
		"nl":    "Dutch",
		"pl":    "Polish",
		"sv":    "Swedish",
		"no":    "Norwegian",
		"da":    "Danish",
		"fi":    "Finnish",
		"tr":    "Turkish",
		"uk":    "Ukrainian",
		"vi":    "Vietnamese",
		"th":    "Thai",
		"id":    "Indonesian",
	}
	if name, ok := names[strings.ToLower(code)]; ok {
		return name
	}
	return code
}
