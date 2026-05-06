package openrouter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListModelsByOutputModality_BadModality(t *testing.T) {
	if _, err := ListModelsByOutputModality(context.Background(), nil, "", "audio"); err == nil {
		t.Fatal("expected error")
	}
}

func TestListModelsByOutputModality_OK(t *testing.T) {
	body := `{"data":[{"id":"m1","name":"Model One","context_length":1024,"pricing":{"prompt":"0.000001","completion":0.000002},"architecture":{"input_modalities":["text"],"output_modalities":["text"]}},{"id":"m2","name":"Model Two"}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("output_modalities") != "text" {
			t.Errorf("query: %v", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	got, err := ListModelsByOutputModality(context.Background(), srv.Client(), srv.URL, "text")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("len %d", len(got))
	}
	if got[0].ID != "m1" || got[0].ContextLength == nil || *got[0].ContextLength != 1024 {
		t.Fatalf("%+v", got[0])
	}
	if got[0].InputPricePerMillionUSD == nil || *got[0].InputPricePerMillionUSD != 1.0 {
		t.Fatalf("input price: %+v", got[0].InputPricePerMillionUSD)
	}
	if got[0].ModalitiesSummary == nil {
		t.Fatal("modalities")
	}
}

func TestListModelsByOutputModality_NonOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte("server boom"))
	}))
	defer srv.Close()
	if _, err := ListModelsByOutputModality(context.Background(), srv.Client(), srv.URL, "text"); err == nil {
		t.Fatal("expected error")
	}
}

func TestListModelsByOutputModality_DefaultBaseAndClient(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // forces NewRequestWithContext to error or send to fail
	if _, err := ListModelsByOutputModality(ctx, nil, "", "image"); err == nil {
		t.Fatal("expected error")
	}
}

func TestUnmarshalU64ish(t *testing.T) {
	if got, ok := unmarshalU64ish(json.RawMessage(`100`)); !ok || *got != 100 {
		t.Fatal("number")
	}
	if got, ok := unmarshalU64ish(json.RawMessage(`"42"`)); !ok || *got != 42 {
		t.Fatal("string number")
	}
	if _, ok := unmarshalU64ish(json.RawMessage(``)); ok {
		t.Fatal("empty")
	}
	if _, ok := unmarshalU64ish(json.RawMessage(`-1`)); ok {
		t.Fatal("negative")
	}
	if _, ok := unmarshalU64ish(json.RawMessage(`"abc"`)); ok {
		t.Fatal("bad string")
	}
	if _, ok := unmarshalU64ish(json.RawMessage(`{}`)); ok {
		t.Fatal("object")
	}
}

func TestPriceToPerMillionUSD(t *testing.T) {
	if priceToPerMillionUSD(nil) != nil {
		t.Fatal("nil")
	}
	if got := priceToPerMillionUSD("0.0001"); got == nil || *got != 100 {
		t.Fatalf("string: %v", got)
	}
	if got := priceToPerMillionUSD(0.001); got == nil || *got != 1000 {
		t.Fatalf("float: %v", got)
	}
	if got := priceToPerMillionUSD(json.Number("0.0001")); got == nil || *got != 100 {
		t.Fatalf("number: %v", got)
	}
	if priceToPerMillionUSD("notanumber") != nil {
		t.Fatal("bad string")
	}
	if priceToPerMillionUSD(json.Number("xx")) != nil {
		t.Fatal("bad json.Number")
	}
	if priceToPerMillionUSD([]int{1, 2}) != nil {
		t.Fatal("unsupported")
	}
}

func TestParsePromptCompletionPricesMillionUSD(t *testing.T) {
	in, out := parsePromptCompletionPricesMillionUSD(json.RawMessage(`null`))
	if in != nil || out != nil {
		t.Fatal("null")
	}
	in, out = parsePromptCompletionPricesMillionUSD(json.RawMessage(``))
	if in != nil || out != nil {
		t.Fatal("empty")
	}
	in, out = parsePromptCompletionPricesMillionUSD(json.RawMessage(`{"prompt":"0.000001","completion":"0.000002"}`))
	if in == nil || out == nil || *in != 1.0 || *out != 2.0 {
		t.Fatalf("got in=%v out=%v", in, out)
	}
	in, out = parsePromptCompletionPricesMillionUSD(json.RawMessage(`junk`))
	if in != nil || out != nil {
		t.Fatal("junk")
	}
}

func TestModalitiesSummaryFromRow_Variants(t *testing.T) {
	if got := modalitiesSummaryFromRow(map[string]json.RawMessage{}); got != nil {
		t.Fatal("missing arch")
	}
	row := map[string]json.RawMessage{"architecture": json.RawMessage(`{"input_modalities":[],"output_modalities":[]}`)}
	if got := modalitiesSummaryFromRow(row); got != nil {
		t.Fatal("empty modalities")
	}
	row = map[string]json.RawMessage{"architecture": json.RawMessage(`junk`)}
	if got := modalitiesSummaryFromRow(row); got != nil {
		t.Fatal("bad arch")
	}
}

func TestParseModelsEnvelope_Errors(t *testing.T) {
	if _, err := parseModelsEnvelope([]byte(`junk`)); err == nil {
		t.Fatal("bad json")
	}
	got, err := parseModelsEnvelope([]byte(`{"data":[{"name":"a"},{"id":"  "}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected filtered to 0, got %v", got)
	}
}
