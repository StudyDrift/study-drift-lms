package openrouter

import (
	"encoding/json"
	"testing"
)

func TestParseModelsEnvelope_minimal(t *testing.T) {
	const raw = `{
  "data": [
    {
      "id": "openai/gpt-4",
      "name": "GPT-4",
      "context_length": 8192,
      "architecture": { "input_modalities": ["text"], "output_modalities": ["text"] }
    }
  ]
}`
	got, err := parseModelsEnvelope([]byte(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len: %d", len(got))
	}
	if got[0].ID != "openai/gpt-4" || got[0].Name != "GPT-4" {
		t.Fatalf("row: %#v", got[0])
	}
	if got[0].ContextLength == nil || *got[0].ContextLength != 8192 {
		t.Fatalf("context: %#v", got[0].ContextLength)
	}
	enc, _ := json.Marshal(got[0])
	var check struct {
		ContextLength *uint64 `json:"contextLength"`
	}
	_ = json.Unmarshal(enc, &check)
	if check.ContextLength == nil {
		t.Fatal("json omitempty on context length")
	}
}
