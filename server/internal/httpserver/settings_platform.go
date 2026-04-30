package httpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/platformconfig"
)

const placeholderSecretResponse = "••••••••••••"

func maskSecret(v string) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	return placeholderSecretResponse
}

func maskPEMIfSet(pem string) string {
	if strings.TrimSpace(pem) == "" {
		return ""
	}
	return placeholderSecretResponse
}

type platformSettingsJSON struct {
	OpenRouterAPIKey string `json:"openRouterApiKey"`

	SAMLSSOEnabled      bool   `json:"samlSsoEnabled"`
	SAMLPublicBaseURL   string `json:"samlPublicBaseUrl"`
	SAMLSPEntityID      string `json:"samlSpEntityId"`
	SAMLSPX509PEM       string `json:"samlSpX509Pem"`
	SAMLSPPrivateKeyPEM string `json:"samlSpPrivateKeyPem"`

	AnnotationEnabled           bool `json:"annotationEnabled"`
	FeedbackMediaEnabled        bool `json:"feedbackMediaEnabled"`
	BlindGradingEnabled         bool `json:"blindGradingEnabled"`
	ModeratedGradingEnabled     bool `json:"moderatedGradingEnabled"`
	OriginalityDetectionEnabled bool `json:"originalityDetectionEnabled"`
	OriginalityStubExternal     bool `json:"originalityStubExternal"`
	GradePostingPoliciesEnabled bool `json:"gradePostingPoliciesEnabled"`
	GradebookCSVEnabled         bool `json:"gradebookCsvEnabled"`
	ResubmissionWorkflowEnabled bool `json:"resubmissionWorkflowEnabled"`
	LTIEnabled                  bool `json:"ltiEnabled"`
	OneRosterEnabled            bool `json:"oneRosterEnabled"`

	Sources platformSourcesJSON `json:"sources"`
}

type platformSourcesJSON struct {
	OpenRouterAPIKey string `json:"openRouterApiKey"`

	SAMLSSOEnabled      string `json:"samlSsoEnabled"`
	SAMLPublicBaseURL   string `json:"samlPublicBaseUrl"`
	SAMLSPEntityID      string `json:"samlSpEntityId"`
	SAMLSPX509PEM       string `json:"samlSpX509Pem"`
	SAMLSPPrivateKeyPEM string `json:"samlSpPrivateKeyPem"`

	AnnotationEnabled           string `json:"annotationEnabled"`
	FeedbackMediaEnabled        string `json:"feedbackMediaEnabled"`
	BlindGradingEnabled         string `json:"blindGradingEnabled"`
	ModeratedGradingEnabled     string `json:"moderatedGradingEnabled"`
	OriginalityDetectionEnabled string `json:"originalityDetectionEnabled"`
	OriginalityStubExternal     string `json:"originalityStubExternal"`
	GradePostingPoliciesEnabled string `json:"gradePostingPoliciesEnabled"`
	GradebookCSVEnabled         string `json:"gradebookCsvEnabled"`
	ResubmissionWorkflowEnabled string `json:"resubmissionWorkflowEnabled"`
	LTIEnabled                  string `json:"ltiEnabled"`
	OneRosterEnabled            string `json:"oneRosterEnabled"`
}

func src(s platformconfig.Source) string {
	return string(s)
}

// handleGetPlatformSettings is GET /api/v1/settings/platform
func (d Deps) handleGetPlatformSettings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		ctx := r.Context()
		var dbRow *platformconfig.Row
		var err error
		if d.Pool != nil {
			dbRow, err = platformconfig.Get(ctx, d.Pool)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load platform settings.")
				return
			}
		}
		merged := platformconfig.Merge(d.Config, dbRow)
		sources := platformconfig.ResolveSources(d.Config, dbRow)
		out := platformSettingsJSON{
			OpenRouterAPIKey:            maskSecret(merged.OpenRouterAPIKey),
			SAMLSSOEnabled:              merged.SAMLSSOEnabled,
			SAMLPublicBaseURL:           merged.SAMLPublicBaseURL,
			SAMLSPEntityID:              merged.SAMLSPEntityID,
			SAMLSPX509PEM:               merged.SAMLSPX509PEM,
			SAMLSPPrivateKeyPEM:         maskPEMIfSet(merged.SAMLSPPrivateKeyPEM),
			AnnotationEnabled:           merged.AnnotationEnabled,
			FeedbackMediaEnabled:        merged.FeedbackMediaEnabled,
			BlindGradingEnabled:         merged.BlindGradingEnabled,
			ModeratedGradingEnabled:     merged.ModeratedGradingEnabled,
			OriginalityDetectionEnabled: merged.OriginalityDetectionEnabled,
			OriginalityStubExternal:     merged.OriginalityStubExternal,
			GradePostingPoliciesEnabled: merged.GradePostingPoliciesEnabled,
			GradebookCSVEnabled:         merged.GradebookCSVEnabled,
			ResubmissionWorkflowEnabled: merged.ResubmissionWorkflowEnabled,
			LTIEnabled:                  merged.LTIEnabled,
			OneRosterEnabled:            merged.OneRosterEnabled,
			Sources: platformSourcesJSON{
				OpenRouterAPIKey:            src(sources.OpenRouterAPIKey),
				SAMLSSOEnabled:              src(sources.SAMLSSOEnabled),
				SAMLPublicBaseURL:           src(sources.SAMLPublicBaseURL),
				SAMLSPEntityID:              src(sources.SAMLSPEntityID),
				SAMLSPX509PEM:               src(sources.SAMLSPX509PEM),
				SAMLSPPrivateKeyPEM:         src(sources.SAMLSPPrivateKeyPEM),
				AnnotationEnabled:           src(sources.AnnotationEnabled),
				FeedbackMediaEnabled:        src(sources.FeedbackMediaEnabled),
				BlindGradingEnabled:         src(sources.BlindGradingEnabled),
				ModeratedGradingEnabled:     src(sources.ModeratedGradingEnabled),
				OriginalityDetectionEnabled: src(sources.OriginalityDetectionEnabled),
				OriginalityStubExternal:     src(sources.OriginalityStubExternal),
				GradePostingPoliciesEnabled: src(sources.GradePostingPoliciesEnabled),
				GradebookCSVEnabled:         src(sources.GradebookCSVEnabled),
				ResubmissionWorkflowEnabled: src(sources.ResubmissionWorkflowEnabled),
				LTIEnabled:                  src(sources.LTIEnabled),
				OneRosterEnabled:            src(sources.OneRosterEnabled),
			},
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

type putPlatformBody struct {
	OpenRouterAPIKey      *string `json:"openRouterApiKey"`
	ClearOpenRouterAPIKey bool    `json:"clearOpenRouterApiKey"`

	SAMLSSOEnabled      *bool   `json:"samlSsoEnabled"`
	SAMLPublicBaseURL   *string `json:"samlPublicBaseUrl"`
	SAMLSPEntityID      *string `json:"samlSpEntityId"`
	SAMLSPX509PEM       *string `json:"samlSpX509Pem"`
	SAMLSPPrivateKeyPEM *string `json:"samlSpPrivateKeyPem"`

	AnnotationEnabled           *bool `json:"annotationEnabled"`
	FeedbackMediaEnabled        *bool `json:"feedbackMediaEnabled"`
	BlindGradingEnabled         *bool `json:"blindGradingEnabled"`
	ModeratedGradingEnabled     *bool `json:"moderatedGradingEnabled"`
	OriginalityDetectionEnabled *bool `json:"originalityDetectionEnabled"`
	OriginalityStubExternal     *bool `json:"originalityStubExternal"`
	GradePostingPoliciesEnabled *bool `json:"gradePostingPoliciesEnabled"`
	GradebookCSVEnabled         *bool `json:"gradebookCsvEnabled"`
	ResubmissionWorkflowEnabled *bool `json:"resubmissionWorkflowEnabled"`
	LTIEnabled                  *bool `json:"ltiEnabled"`
	OneRosterEnabled            *bool `json:"oneRosterEnabled"`

	UpdateMask []string `json:"updateMask"`
}

// handlePutPlatformSettings is PUT /api/v1/settings/platform
func (d Deps) handlePutPlatformSettings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Database is not configured.")
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var body putPlatformBody
		if err := json.Unmarshal(b, &body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		mask := map[string]struct{}{}
		for _, k := range body.UpdateMask {
			k = strings.TrimSpace(k)
			if k != "" {
				mask[strings.ToLower(k)] = struct{}{}
			}
		}

		wr := &platformconfig.Write{}
		clearRouter := body.ClearOpenRouterAPIKey
		if len(mask) > 0 {
			clearRouter = false
			if _, ok := mask["clearopenrouterapikey"]; ok {
				clearRouter = true
			}
		}

		set := func(field string, hasInput bool, apply func()) {
			if len(mask) > 0 {
				if _, ok := mask[strings.ToLower(field)]; !ok {
					return
				}
			} else {
				if !hasInput {
					return
				}
			}
			apply()
		}

		set("openrouterapikey", body.OpenRouterAPIKey != nil, func() {
			s := strings.TrimSpace(*body.OpenRouterAPIKey)
			if s != "" && s != placeholderSecretResponse {
				wr.OpenRouterAPIKey = &s
			}
		})

		if clearRouter && wr.OpenRouterAPIKey != nil && strings.TrimSpace(*wr.OpenRouterAPIKey) != "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Cannot set openRouterApiKey and clearOpenRouterApiKey together.")
			return
		}
		if clearRouter {
			if err := platformconfig.ClearOpenRouterAPIKey(r.Context(), d.Pool); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to clear OpenRouter override.")
				return
			}
		}
		set("samlssoenabled", body.SAMLSSOEnabled != nil, func() {
			v := *body.SAMLSSOEnabled
			wr.SAMLSSOEnabled = &v
		})
		set("samlpublicbaseurl", body.SAMLPublicBaseURL != nil, func() {
			s := strings.TrimSpace(*body.SAMLPublicBaseURL)
			wr.SAMLPublicBaseURL = &s
		})
		set("samlspentityid", body.SAMLSPEntityID != nil, func() {
			s := strings.TrimSpace(*body.SAMLSPEntityID)
			wr.SAMLSPEntityID = &s
		})
		set("samlspx509pem", body.SAMLSPX509PEM != nil, func() {
			s := strings.TrimSpace(*body.SAMLSPX509PEM)
			if s != "" && s != placeholderSecretResponse {
				wr.SAMLSPX509PEM = &s
			}
		})
		set("samlprivatekeypem", body.SAMLSPPrivateKeyPEM != nil, func() {
			s := strings.TrimSpace(*body.SAMLSPPrivateKeyPEM)
			if s != "" && s != placeholderSecretResponse {
				wr.SAMLSPPrivateKeyPEM = &s
			}
		})
		set("annotationenabled", body.AnnotationEnabled != nil, func() {
			v := *body.AnnotationEnabled
			wr.AnnotationEnabled = &v
		})
		set("feedbackmediaenabled", body.FeedbackMediaEnabled != nil, func() {
			v := *body.FeedbackMediaEnabled
			wr.FeedbackMediaEnabled = &v
		})
		set("blindgradingenabled", body.BlindGradingEnabled != nil, func() {
			v := *body.BlindGradingEnabled
			wr.BlindGradingEnabled = &v
		})
		set("moderatedgradingenabled", body.ModeratedGradingEnabled != nil, func() {
			v := *body.ModeratedGradingEnabled
			wr.ModeratedGradingEnabled = &v
		})
		set("originalitydetectionenabled", body.OriginalityDetectionEnabled != nil, func() {
			v := *body.OriginalityDetectionEnabled
			wr.OriginalityDetectionEnabled = &v
		})
		set("originalitystubexternal", body.OriginalityStubExternal != nil, func() {
			v := *body.OriginalityStubExternal
			wr.OriginalityStubExternal = &v
		})
		set("gradepostingpoliciesenabled", body.GradePostingPoliciesEnabled != nil, func() {
			v := *body.GradePostingPoliciesEnabled
			wr.GradePostingPoliciesEnabled = &v
		})
		set("gradebookcsvenabled", body.GradebookCSVEnabled != nil, func() {
			v := *body.GradebookCSVEnabled
			wr.GradebookCSVEnabled = &v
		})
		set("resubmissionworkflowenabled", body.ResubmissionWorkflowEnabled != nil, func() {
			v := *body.ResubmissionWorkflowEnabled
			wr.ResubmissionWorkflowEnabled = &v
		})
		set("ltienabled", body.LTIEnabled != nil, func() {
			v := *body.LTIEnabled
			wr.LTIEnabled = &v
		})
		set("onerosterenabled", body.OneRosterEnabled != nil, func() {
			v := *body.OneRosterEnabled
			wr.OneRosterEnabled = &v
		})

		dbRow, err := platformconfig.Upsert(r.Context(), d.Pool, wr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save platform settings.")
			return
		}
		merged := platformconfig.Merge(d.Config, dbRow)
		if err := merged.Validate(); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		if d.Platform != nil {
			d.Platform.Reload(merged)
		}
		if d.OIDC != nil {
			d.OIDC = nil
		}

		sources := platformconfig.ResolveSources(d.Config, dbRow)
		out := platformSettingsJSON{
			OpenRouterAPIKey:            maskSecret(merged.OpenRouterAPIKey),
			SAMLSSOEnabled:              merged.SAMLSSOEnabled,
			SAMLPublicBaseURL:           merged.SAMLPublicBaseURL,
			SAMLSPEntityID:              merged.SAMLSPEntityID,
			SAMLSPX509PEM:               merged.SAMLSPX509PEM,
			SAMLSPPrivateKeyPEM:         maskPEMIfSet(merged.SAMLSPPrivateKeyPEM),
			AnnotationEnabled:           merged.AnnotationEnabled,
			FeedbackMediaEnabled:        merged.FeedbackMediaEnabled,
			BlindGradingEnabled:         merged.BlindGradingEnabled,
			ModeratedGradingEnabled:     merged.ModeratedGradingEnabled,
			OriginalityDetectionEnabled: merged.OriginalityDetectionEnabled,
			OriginalityStubExternal:     merged.OriginalityStubExternal,
			GradePostingPoliciesEnabled: merged.GradePostingPoliciesEnabled,
			GradebookCSVEnabled:         merged.GradebookCSVEnabled,
			ResubmissionWorkflowEnabled: merged.ResubmissionWorkflowEnabled,
			LTIEnabled:                  merged.LTIEnabled,
			OneRosterEnabled:            merged.OneRosterEnabled,
			Sources: platformSourcesJSON{
				OpenRouterAPIKey:            src(sources.OpenRouterAPIKey),
				SAMLSSOEnabled:              src(sources.SAMLSSOEnabled),
				SAMLPublicBaseURL:           src(sources.SAMLPublicBaseURL),
				SAMLSPEntityID:              src(sources.SAMLSPEntityID),
				SAMLSPX509PEM:               src(sources.SAMLSPX509PEM),
				SAMLSPPrivateKeyPEM:         src(sources.SAMLSPPrivateKeyPEM),
				AnnotationEnabled:           src(sources.AnnotationEnabled),
				FeedbackMediaEnabled:        src(sources.FeedbackMediaEnabled),
				BlindGradingEnabled:         src(sources.BlindGradingEnabled),
				ModeratedGradingEnabled:     src(sources.ModeratedGradingEnabled),
				OriginalityDetectionEnabled: src(sources.OriginalityDetectionEnabled),
				OriginalityStubExternal:     src(sources.OriginalityStubExternal),
				GradePostingPoliciesEnabled: src(sources.GradePostingPoliciesEnabled),
				GradebookCSVEnabled:         src(sources.GradebookCSVEnabled),
				ResubmissionWorkflowEnabled: src(sources.ResubmissionWorkflowEnabled),
				LTIEnabled:                  src(sources.LTIEnabled),
				OneRosterEnabled:            src(sources.OneRosterEnabled),
			},
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}
