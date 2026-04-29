// OpenRouter public GET /v1/models (no API key required) for the settings UI model pickers.
package openrouter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ListedModel is a row from the OpenRouter models list (for JSON output to the web app).
type ListedModel struct {
	ID                        string   `json:"id"`
	Name                      string   `json:"name"`
	ContextLength             *uint64  `json:"contextLength,omitempty"`
	InputPricePerMillionUSD   *float64 `json:"inputPricePerMillionUsd,omitempty"`
	OutputPricePerMillionUSD  *float64 `json:"outputPricePerMillionUsd,omitempty"`
	ModalitiesSummary         *string  `json:"modalitiesSummary,omitempty"`
}

// ListModelsByOutputModality calls OpenRouter with output_modalities=text|image
// (public endpoint; no bearer token required).
func ListModelsByOutputModality(ctx context.Context, httpClient *http.Client, baseURL, modality string) ([]ListedModel, error) {
	base := strings.TrimRight(baseURL, "/")
	if base == "" {
		base = DefaultBaseURL
	}
	mod := strings.ToLower(strings.TrimSpace(modality))
	if mod != "text" && mod != "image" {
		return nil, fmt.Errorf("openrouter: invalid output modality %q (want text or image)", modality)
	}
	u, err := url.Parse(base + "/models")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("output_modalities", mod)
	u.RawQuery = q.Encode()
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := string(b)
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		return nil, fmt.Errorf("openrouter: list models: status %d: %s", res.StatusCode, msg)
	}
	return parseModelsEnvelope(b)
}

func parseModelsEnvelope(raw []byte) ([]ListedModel, error) {
	var top struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, fmt.Errorf("openrouter: parse models: %w", err)
	}
	var out []ListedModel
	for _, row := range top.Data {
		idBytes, ok := row["id"]
		if !ok {
			continue
		}
		var id string
		_ = json.Unmarshal(idBytes, &id)
		if strings.TrimSpace(id) == "" {
			continue
		}
		name := id
		if n, ok := row["name"]; ok {
			_ = json.Unmarshal(n, &name)
		}
		if strings.TrimSpace(name) == "" {
			name = id
		}
		var cl *uint64
		if v, ok := row["context_length"]; ok {
			if u64, ok := unmarshalU64ish(v); ok {
				cl = u64
			}
		}
		var inPrice, outPrice *float64
		if p, ok := row["pricing"]; ok {
			inPrice, outPrice = parsePromptCompletionPricesMillionUSD(p)
		}
		mods := modalitiesSummaryFromRow(row)
		out = append(out, ListedModel{
			ID:                       id,
			Name:                     name,
			ContextLength:            cl,
			InputPricePerMillionUSD:  inPrice,
			OutputPricePerMillionUSD: outPrice,
			ModalitiesSummary:      mods,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func unmarshalU64ish(v json.RawMessage) (*uint64, bool) {
	if len(v) == 0 {
		return nil, false
	}
	var f float64
	if err := json.Unmarshal(v, &f); err == nil {
		if f < 0 {
			return nil, false
		}
		u := uint64(f)
		return &u, true
	}
	// string number
	var s string
	if err := json.Unmarshal(v, &s); err == nil {
		if n, err := strconv.ParseUint(s, 10, 64); err == nil {
			return &n, true
		}
	}
	return nil, false
}

func parsePromptCompletionPricesMillionUSD(v json.RawMessage) (prompt *float64, compl *float64) {
	if len(v) == 0 || string(v) == "null" {
		return nil, nil
	}
	var p struct {
		Prompt     any `json:"prompt"`
		Completion any `json:"completion"`
	}
	if err := json.Unmarshal(v, &p); err != nil {
		return nil, nil
	}
	return priceToPerMillionUSD(p.Prompt), priceToPerMillionUSD(p.Completion)
}

func priceToPerMillionUSD(v any) *float64 {
	if v == nil {
		return nil
	}
	var per float64
	switch t := v.(type) {
	case string:
		var err error
		per, err = strconv.ParseFloat(t, 64)
		if err != nil {
			return nil
		}
	case float64:
		per = t
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return nil
		}
		per = f
	default:
		return nil
	}
	x := per * 1_000_000.0
	return &x
}

func modalitiesSummaryFromRow(row map[string]json.RawMessage) *string {
	archBytes, ok := row["architecture"]
	if !ok {
		return nil
	}
	var arch struct {
		InputModalities  []string `json:"input_modalities"`
		OutputModalities []string `json:"output_modalities"`
	}
	if err := json.Unmarshal(archBytes, &arch); err != nil {
		return nil
	}
	inS := strings.Join(arch.InputModalities, "+")
	outS := strings.Join(arch.OutputModalities, "+")
	if inS == "" && outS == "" {
		return nil
	}
	s := inS + " -> " + outS
	return &s
}
