// Package openrouter implements the OpenAI-compatible OpenRouter chat API used by the Rust server.
package openrouter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultBaseURL is the public OpenRouter API base (chat, models list).
const DefaultBaseURL = "https://openrouter.ai/api/v1"

// Client calls OpenRouter's /chat/completions endpoint.
type Client struct {
	HTTP    *http.Client
	apiKey  string
	baseURL string
}

// NewClient returns a client with the public OpenRouter base URL.
func NewClient(apiKey string) *Client {
	return &Client{
		HTTP:    &http.Client{Timeout: 120 * time.Second},
		apiKey:  strings.TrimSpace(apiKey),
		baseURL: DefaultBaseURL,
	}
}

// NewClientWithBaseURL is for tests (httptest server).
func NewClientWithBaseURL(apiKey, baseURL string) *Client {
	return &Client{
		HTTP:    &http.Client{Timeout: 30 * time.Second},
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
	}
}

// Message is one chat message (OpenAI format).
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatCompletion sends a non-streaming chat request and returns the assistant text, if any.
func (c *Client) ChatCompletion(model string, messages []Message) (string, error) {
	if c == nil {
		return "", fmt.Errorf("openrouter: nil client")
	}
	if c.apiKey == "" {
		return "", fmt.Errorf("openrouter: missing API key")
	}
	base := c.baseURL
	if base == "" {
		base = DefaultBaseURL
	}
	body := map[string]any{
		"model":    model,
		"messages": messages,
		"stream":   false,
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	u := base + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, u, bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		return "", err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := string(b)
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		return "", fmt.Errorf("openrouter: status %d: %s", res.StatusCode, msg)
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content *string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return "", fmt.Errorf("openrouter: parse response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("openrouter: no choices in response")
	}
	if parsed.Choices[0].Message.Content == nil {
		return "", nil
	}
	return *parsed.Choices[0].Message.Content, nil
}
