package questionbank

import (
	"encoding/json"
	"testing"
)

func TestMergeQuestionOptionsOnWrite(t *testing.T) {
	submitted, _ := json.Marshal([]string{"A", "B"})
	existing := json.RawMessage(`[{"id":"11111111-1111-1111-1111-111111111111","text":"A"},{"id":"22222222-2222-2222-2222-222222222222","text":"X"}]`)
	out := mergeQuestionOptionsOnWrite(submitted, &existing)
	var arr []map[string]any
	if err := json.Unmarshal(out, &arr); err != nil {
		t.Fatal(err)
	}
	if len(arr) != 2 || arr[0]["text"] != "A" || arr[1]["text"] != "B" {
		t.Fatalf("unexpected %v", arr)
	}
	if arr[0]["id"] != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("expected stable id for matching text, got %v", arr[0]["id"])
	}
}
