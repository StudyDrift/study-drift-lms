package httpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/repos/oidc"
	"github.com/lextures/lextures/server/internal/repos/originalityconfig"
	"github.com/lextures/lextures/server/internal/repos/originalityreports"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/samlidp"
	"github.com/lextures/lextures/server/internal/service/authservice"
	"github.com/lextures/lextures/server/internal/service/irtcalibration"
)

const permGlobalRBACManage = "global:app:rbac:manage"

// adminRbacUser authenticates the request and enforces `global:app:rbac:manage`.
func (d Deps) adminRbacUser(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	if d.JWTSigner == nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	u, err := auth.UserFromRequest(r, d.JWTSigner)
	if err != nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	userID, err := uuid.Parse(u.UserID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	if d.Pool == nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
		return uuid.UUID{}, false
	}
	ctx := r.Context()
	ok, err := rbac.UserHasPermission(ctx, d.Pool, userID, permGlobalRBACManage)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
		return uuid.UUID{}, false
	}
	if !ok {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return uuid.UUID{}, false
	}
	return userID, true
}

func (d Deps) handleAdminIRTCalibrate() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var body struct {
			ConceptID *string `json:"conceptId"`
		}
		if len(b) > 0 {
			_ = json.Unmarshal(b, &body)
		}
		var concept *uuid.UUID
		if body.ConceptID != nil && *body.ConceptID != "" {
			c, err := uuid.Parse(*body.ConceptID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid conceptId.")
				return
			}
			concept = &c
		}
		jobID := uuid.New()
		irtcalibration.RunInBackground(d.Pool, jobID, concept)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"jobId": jobID.String()})
	}
}

type putOriginalityConfigBody struct {
	DpaAcceptedAt          *time.Time `json:"dpaAcceptedAt"`
	ActiveExternalProvider string     `json:"activeExternalProvider"`
	ProviderAPIKey         *string    `json:"providerApiKey"`
	WebhookHMACSecret      *string    `json:"webhookHmacSecret"`
	SimilarityAmberMinPct  *int       `json:"similarityAmberMinPct"`
	SimilarityRedMinPct    *int       `json:"similarityRedMinPct"`
	AIAmberMinPct          *int       `json:"aiAmberMinPct"`
	AIRedMinPct            *int       `json:"aiRedMinPct"`
}

func (d Deps) handleAdminPutOriginality() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		var b putOriginalityConfigBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		p := strings.ToLower(strings.TrimSpace(b.ActiveExternalProvider))
		if p != "none" && p != "turnitin" && p != "copyleaks" && p != "gptzero" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "activeExternalProvider must be none, turnitin, copyleaks, or gptzero.")
			return
		}
		write := &originalityconfig.Write{
			DpaAcceptedAt:         b.DpaAcceptedAt,
			ActiveExternalProvider: p,
			ProviderAPIKey:         b.ProviderAPIKey,
			WebhookHMACSecret:     b.WebhookHMACSecret,
			SimilarityAmberMinPct:  pctF(b.SimilarityAmberMinPct, 25),
			SimilarityRedMinPct:    pctF(b.SimilarityRedMinPct, 50),
			AIAmberMinPct:         pctF(b.AIAmberMinPct, 25),
			AIRedMinPct:            pctF(b.AIRedMinPct, 50),
		}
		if err := originalityconfig.UpsertSingleton(r.Context(), d.Pool, write); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

func pctF(p *int, def int) float64 {
	n := def
	if p != nil {
		n = *p
	}
	if n < 0 {
		n = 0
	}
	if n > 100 {
		n = 100
	}
	return float64(n)
}

func (d Deps) handleAdminDSARExport() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		uidS := chi.URLParam(r, "userId")
		userID, err := uuid.Parse(uidS)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid user id.")
			return
		}
		rows, err := originalityreports.ListFerpaForUser(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			m := map[string]any{
				"reportId":     row.ReportID.String(),
				"submissionId": row.SubmissionID.String(),
				"courseCode":   row.CourseCode,
				"moduleItemId": row.ModuleItemID.String(),
				"provider":     row.Provider,
				"status":       row.Status,
				"reportDate":   row.UpdatedAt.UTC().Format(time.RFC3339),
			}
			if row.SimilarityPct != nil {
				m["similarityPct"] = *row.SimilarityPct
			} else {
				m["similarityPct"] = nil
			}
			if row.AIProbability != nil {
				m["aiProbability"] = *row.AIProbability
			} else {
				m["aiProbability"] = nil
			}
			items = append(items, m)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"userId":             userID.String(),
			"originalityReports": items,
			"version":            1,
			"exportKind":         "ferpa-slice",
		})
	}
}

func (d Deps) handleAdminRevokeUserSessions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		uidS := chi.URLParam(r, "userId")
		userID, err := uuid.Parse(uidS)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid user id.")
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if err := authservice.RevokeAllSessionsForUser(r.Context(), d.Pool, userID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

func (d Deps) handleAdminSAMLGet() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		row, err := samlidp.GetDefaultIdP(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if row == nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write([]byte(`{"config":null}`))
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		var inst any
		if row.InstitutionID != nil {
			inst = row.InstitutionID.String()
		} else {
			inst = nil
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":                 row.ID.String(),
			"institutionId":     inst,
			"displayName":       row.DisplayName,
			"entityId":          row.EntityID,
			"ssoUrl":            row.SSOURL,
			"sloUrl":            row.SLOURL,
			"attributeMapping":  json.RawMessage(row.AttributeMapping),
			"forceSaml":         row.ForceSAML,
		})
	}
}

type putSAMLBody struct {
	ID                 *string          `json:"id"`
	InstitutionID     *string          `json:"institutionId"`
	DisplayName        string          `json:"displayName"`
	EntityID          string          `json:"entityId"`
	SSOURL            string          `json:"ssoUrl"`
	SLOURL            *string         `json:"sloUrl"`
	IDPCertPem        string          `json:"idpCertPem"`
	AttributeMapping  json.RawMessage  `json:"attributeMapping"`
	ForceSAML         bool            `json:"forceSaml"`
}

func (d Deps) handleAdminSAMLPut() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		var b putSAMLBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		wb := samlidp.IdPWrite{
			DisplayName: strings.TrimSpace(b.DisplayName),
			EntityID:    strings.TrimSpace(b.EntityID),
			SSOURL:      strings.TrimSpace(b.SSOURL),
			SLOURL:      b.SLOURL,
			IDPCertPem:  b.IDPCertPem,
			ForceSAML:  b.ForceSAML,
		}
		if b.InstitutionID != nil && *b.InstitutionID != "" {
			u, err := uuid.Parse(*b.InstitutionID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid institutionId.")
				return
			}
			wb.InstitutionID = &u
		}
		if len(b.AttributeMapping) == 0 {
			wb.AttributeMapping = []byte(`{}`)
		} else {
			wb.AttributeMapping = b.AttributeMapping
		}
		if wb.EntityID == "" || wb.SSOURL == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "entityId and ssoUrl are required.")
			return
		}
		var id *uuid.UUID
		if b.ID != nil && *b.ID != "" {
			parsed, err := uuid.Parse(*b.ID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
				return
			}
			id = &parsed
		}
		row, err := samlidp.UpsertIdP(r.Context(), d.Pool, id, &wb)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":        row.ID.String(),
			"entityId": row.EntityID,
		})
	}
}

func (d Deps) handleAdminOIDCProvidersGet() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		rows, err := oidc.ListCustomConfigs(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			var inst any
			if row.InstitutionID != nil {
				inst = row.InstitutionID.String()
			} else {
				inst = nil
			}
			m := map[string]any{
				"id":               row.ID.String(),
				"institutionId":    inst,
				"displayName":      row.DisplayName,
				"clientId":         row.ClientID,
				"hasClientSecret":  row.HasClientSecret(),
				"discoveryUrl":     row.DiscoveryURL,
				"hdRestriction":    row.HDRestriction,
				"attributeMapping": json.RawMessage(row.AttributeMapping),
			}
			items = append(items, m)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"providers": items})
	}
}

type putOIDCProviderBody struct {
	ID                *string         `json:"id"`
	InstitutionID     *string         `json:"institutionId"`
	DisplayName        string         `json:"displayName"`
	ClientID          string         `json:"clientId"`
	ClientSecret      string         `json:"clientSecret"`
	DiscoveryURL      string         `json:"discoveryUrl"`
	HDRestriction     *string        `json:"hdRestriction"`
	AttributeMapping  json.RawMessage `json:"attributeMapping"`
}

func (d Deps) handleAdminOIDCProviderPut() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		var b putOIDCProviderBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		mapping := b.AttributeMapping
		if len(mapping) == 0 {
			mapping = []byte(`{}`)
		} else {
			// if client sent "null" parse as empty object
			var m map[string]any
			if err := json.Unmarshal(mapping, &m); err != nil || m == nil {
				mapping = []byte(`{}`)
			}
		}
		hr := b.HDRestriction
		if hr != nil {
			t := strings.TrimSpace(*hr)
			if t == "" {
				hr = nil
			} else {
				hr = &t
			}
		}
		wb := oidc.CustomConfigWrite{
			DisplayName:     strings.TrimSpace(b.DisplayName),
			ClientID:         strings.TrimSpace(b.ClientID),
			ClientSecret:     b.ClientSecret,
			DiscoveryURL:     strings.TrimSpace(b.DiscoveryURL),
			HDRestriction:    hr,
			AttributeMapping: mapping,
		}
		if b.InstitutionID != nil && *b.InstitutionID != "" {
			u, err := uuid.Parse(*b.InstitutionID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid institutionId.")
				return
			}
			wb.InstitutionID = &u
		}
		if wb.ClientID == "" || wb.DiscoveryURL == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "clientId and discoveryUrl are required.")
			return
		}
		var id *uuid.UUID
		if b.ID != nil && *b.ID != "" {
			parsed, err := uuid.Parse(*b.ID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
				return
			}
			id = &parsed
		}
		out, err := oidc.UpsertCustomConfig(r.Context(), d.Pool, id, &wb)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": out.String()})
	}
}

func (d Deps) registerAdminRoutes(r chi.Router) {
	r.Post("/api/v1/admin/jobs/irt-calibrate", d.handleAdminIRTCalibrate())
	r.Get("/api/v1/admin/orgs", d.handleAdminOrgsCollection())
	r.Post("/api/v1/admin/orgs", d.handleAdminOrgsCollection())
	r.Get("/api/v1/admin/orgs/{id}", d.handleAdminOrgItem())
	r.Patch("/api/v1/admin/orgs/{id}", d.handleAdminOrgItem())
	r.Delete("/api/v1/admin/orgs/{id}", d.handleAdminOrgItem())
	r.Get("/api/v1/admin/orgs/{orgId}/units", d.handleAdminOrgUnitsCollection())
	r.Post("/api/v1/admin/orgs/{orgId}/units", d.handleAdminOrgUnitsCollection())
	r.Get("/api/v1/admin/orgs/{orgId}/units/tree", d.handleAdminOrgUnitsTree())
	r.Get("/api/v1/admin/orgs/{orgId}/units/{unitId}", d.handleAdminOrgUnitItem())
	r.Patch("/api/v1/admin/orgs/{orgId}/units/{unitId}", d.handleAdminOrgUnitItem())
	r.Delete("/api/v1/admin/orgs/{orgId}/units/{unitId}", d.handleAdminOrgUnitItem())
	r.Post("/api/v1/admin/orgs/{orgId}/units/{unitId}/children", d.handleAdminOrgUnitChildren())
	r.Post("/api/v1/admin/orgs/{orgId}/units/{unitId}/org-unit-admins", d.handleAdminOrgUnitAssignAdmin())
	r.Patch("/api/v1/admin/orgs/{orgId}/courses/{courseCode}/org-unit", d.handleAdminOrgCourseOrgUnit())
	r.Get("/api/v1/admin/orgs/{orgId}/terms", d.handleAdminOrgTermsList())
	r.Put("/api/v1/admin/originality-config", d.handleAdminPutOriginality())
	r.Get("/api/v1/admin/users/{userId}/dsar-export", d.handleAdminDSARExport())
	r.Delete("/api/v1/admin/users/{userId}/sessions", d.handleAdminRevokeUserSessions())
	r.Get("/api/v1/admin/saml/config", d.handleAdminSAMLGet())
	r.Put("/api/v1/admin/saml/config", d.handleAdminSAMLPut())
	r.Get("/api/v1/admin/oidc/providers", d.handleAdminOIDCProvidersGet())
	r.Put("/api/v1/admin/oidc/providers", d.handleAdminOIDCProviderPut())
	r.Post("/api/v1/admin/provisioning/oneroster/upload", d.handleAdminOneRosterUpload())
	r.Get("/api/v1/admin/provisioning/oneroster/sync-runs", d.handleAdminOneRosterSyncRunsList())
	r.Get("/api/v1/admin/provisioning/oneroster/sync-runs/{id}", d.handleAdminOneRosterSyncRunDetail())
	r.Post("/api/v1/admin/provisioning/oneroster/bearer-credentials", d.handleAdminOneRosterBearerPost())
	r.Get("/api/v1/admin/provisioning/scim/tokens", d.handleAdminScimTokensList())
	r.Post("/api/v1/admin/provisioning/scim/tokens", d.handleAdminScimTokenPost())
	r.Delete("/api/v1/admin/provisioning/scim/tokens/{id}", d.handleAdminScimTokenDelete())
	r.Get("/api/v1/admin/provisioning/scim/events", d.handleAdminScimEventsList())
	r.Get("/api/v1/admin/password-policy", d.handleAdminPasswordPolicyGet())
	r.Put("/api/v1/admin/password-policy", d.handleAdminPasswordPolicyPut())
}
