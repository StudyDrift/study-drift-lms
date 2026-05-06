package oidcauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const cleverAPIBase = "https://api.clever.com"

// CleverMeProfile holds fields from Clever API GET /v3.0/me used for JIT and COPPA.
type CleverMeProfile struct {
	UserID     string
	Email      string
	GivenName  string
	FamilyName string
	IsMinor    bool
	RoleName   string // Student, Teacher, or TA for rbac.AssignUserRoleByName
}

type cleverMeEnvelope struct {
	Data *struct {
		ID   string          `json:"id"`
		Data json.RawMessage `json:"data"`
	} `json:"data"`
}

type cleverUserData struct {
	Email string `json:"email"`
	Name  *struct {
		First string `json:"first"`
		Last  string `json:"last"`
	} `json:"name"`
	Roles *struct {
		Student       json.RawMessage `json:"student"`
		Teacher       json.RawMessage `json:"teacher"`
		Staff         json.RawMessage `json:"staff"`
		DistrictAdmin json.RawMessage `json:"district_admin"`
	} `json:"roles"`
}

// FetchCleverMe calls Clever's /v3.0/me with a bearer access token (Instant Login).
func FetchCleverMe(ctx context.Context, hc *http.Client, accessToken string) (*CleverMeProfile, error) {
	tok := strings.TrimSpace(accessToken)
	if tok == "" {
		return nil, fmt.Errorf("clever: missing access token")
	}
	if hc == nil {
		hc = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cleverAPIBase+"/v3.0/me", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	res, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("clever /me: status %d", res.StatusCode)
	}
	var env cleverMeEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	if env.Data == nil || strings.TrimSpace(env.Data.ID) == "" {
		return nil, fmt.Errorf("clever /me: missing user id")
	}
	var ud cleverUserData
	if len(env.Data.Data) > 0 {
		_ = json.Unmarshal(env.Data.Data, &ud)
	}
	role := cleverRoleToAppRole(ud.Roles)
	em := strings.TrimSpace(strings.ToLower(ud.Email))
	gn, fn := "", ""
	if ud.Name != nil {
		gn = strings.TrimSpace(ud.Name.First)
		fn = strings.TrimSpace(ud.Name.Last)
	}
	return &CleverMeProfile{
		UserID:     strings.TrimSpace(env.Data.ID),
		Email:      em,
		GivenName:  gn,
		FamilyName: fn,
		IsMinor:    cleverDetectMinor(env.Data.Data),
		RoleName:   role,
	}, nil
}

func cleverDetectMinor(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return false
	}
	for _, k := range []string{"is_under_13", "isUnder13", "under_13"} {
		if v, ok := m[k]; ok {
			switch t := v.(type) {
			case bool:
				return t
			case string:
				return strings.EqualFold(t, "true") || t == "1"
			case float64:
				return t != 0
			}
		}
	}
	return false
}

func cleverRoleToAppRole(r *struct {
	Student       json.RawMessage `json:"student"`
	Teacher       json.RawMessage `json:"teacher"`
	Staff         json.RawMessage `json:"staff"`
	DistrictAdmin json.RawMessage `json:"district_admin"`
}) string {
	if r == nil {
		return "Student"
	}
	if len(r.DistrictAdmin) > 0 && string(r.DistrictAdmin) != "null" {
		return "Teacher"
	}
	if len(r.Teacher) > 0 && string(r.Teacher) != "null" {
		return "Teacher"
	}
	if len(r.Staff) > 0 && string(r.Staff) != "null" {
		return "Teacher"
	}
	return "Student"
}

// ClassLinkProfile holds identity fields from ClassLink userinfo claims.
type ClassLinkProfile struct {
	SourcedID  string
	Email      string
	GivenName  string
	FamilyName string
	RoleName   string
}

// ParseClassLinkUserInfoClaims maps ClassLink userinfo JSON claims to a profile.
func ParseClassLinkUserInfoClaims(raw map[string]any) ClassLinkProfile {
	var p ClassLinkProfile
	if v, ok := raw["email"].(string); ok {
		p.Email = strings.TrimSpace(strings.ToLower(v))
	}
	if v, ok := raw["given_name"].(string); ok {
		p.GivenName = strings.TrimSpace(v)
	}
	if v, ok := raw["family_name"].(string); ok {
		p.FamilyName = strings.TrimSpace(v)
	}
	for _, k := range []string{"classLink_sourcedId", "classlink_sourcedid", "sourcedId"} {
		if v, ok := raw[k].(string); ok && strings.TrimSpace(v) != "" {
			p.SourcedID = strings.TrimSpace(v)
			break
		}
	}
	p.RoleName = "Student"
	if v, ok := raw["classLink_role"].(string); ok {
		rl := strings.ToLower(strings.TrimSpace(v))
		if strings.Contains(rl, "admin") || strings.Contains(rl, "teacher") || strings.Contains(rl, "staff") {
			p.RoleName = "Teacher"
		}
	}
	return p
}
