package httpserver

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/provisioning/oneroster"
)

const maxOneRosterUploadBytes = 52 << 20 // 52 MiB

func (d Deps) handleAdminOneRosterUpload() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().OneRosterEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "OneRoster is not enabled.")
			return
		}
		actorID, ok := d.adminRbacUser(w, r)
		if !ok {
			return
		}
		if err := r.ParseMultipartForm(maxOneRosterUploadBytes); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid multipart form.")
			return
		}
		instStr := strings.TrimSpace(r.FormValue("institutionId"))
		instID, err := uuid.Parse(instStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "institutionId must be a UUID.")
			return
		}
		var files []oneroster.CSVFile
		for _, fhArr := range r.MultipartForm.File {
			for _, fh := range fhArr {
				if !strings.HasSuffix(strings.ToLower(fh.Filename), ".csv") {
					continue
				}
				f, err := fh.Open()
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not read uploaded file.")
					return
				}
				b, err := io.ReadAll(f)
				_ = f.Close()
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not read uploaded file.")
					return
				}
				files = append(files, oneroster.CSVFile{Name: fh.Filename, Data: b})
			}
		}
		if len(files) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Upload at least one .csv file (e.g. users.csv).")
			return
		}
		runID, err := oneroster.RunCSV(r.Context(), d.Pool, oneroster.SyncParams{
			InstitutionID: instID,
			ActorUserID:   actorID,
			Trigger:       "csv_upload",
			Files:         files,
		})
		if err != nil {
			var mc oneroster.ErrMissingColumn
			if errors.As(err, &mc) {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "OneRoster import failed.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"syncRunId": runID.String()})
	}
}

func (d Deps) handleAdminOneRosterSyncRunsList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().OneRosterEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "OneRoster is not enabled.")
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		instStr := strings.TrimSpace(r.URL.Query().Get("institutionId"))
		instID, err := uuid.Parse(instStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "institutionId query param required (UUID).")
			return
		}
		rows, err := d.Pool.Query(r.Context(), `
SELECT id, institution_id, trigger, status, created_count, updated_count, deactivated_count, error_count,
       started_at, completed_at, error_message
FROM provisioning.oneroster_sync_runs
WHERE institution_id = $1
ORDER BY started_at DESC
LIMIT 100
`, instID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list sync runs.")
			return
		}
		defer rows.Close()
		type row struct {
			ID                string  `json:"id"`
			InstitutionID     string  `json:"institutionId"`
			Trigger           string  `json:"trigger"`
			Status            string  `json:"status"`
			CreatedCount      int     `json:"createdCount"`
			UpdatedCount      int     `json:"updatedCount"`
			DeactivatedCount  int     `json:"deactivatedCount"`
			ErrorCount        int     `json:"errorCount"`
			StartedAt         string  `json:"startedAt"`
			CompletedAt       *string `json:"completedAt,omitempty"`
			ErrorMessage      *string `json:"errorMessage,omitempty"`
		}
		var out []row
		for rows.Next() {
			var rr row
			var startedAt time.Time
			var completedAt sql.NullTime
			var errMsg *string
			if err := rows.Scan(&rr.ID, &rr.InstitutionID, &rr.Trigger, &rr.Status, &rr.CreatedCount, &rr.UpdatedCount, &rr.DeactivatedCount, &rr.ErrorCount, &startedAt, &completedAt, &errMsg); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to read sync runs.")
				return
			}
			rr.StartedAt = startedAt.UTC().Format(time.RFC3339Nano)
			if completedAt.Valid {
				s := completedAt.Time.UTC().Format(time.RFC3339Nano)
				rr.CompletedAt = &s
			}
			rr.ErrorMessage = errMsg
			out = append(out, rr)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"syncRuns": out})
	}
}

func (d Deps) handleAdminOneRosterSyncRunDetail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().OneRosterEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "OneRoster is not enabled.")
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		idStr := strings.TrimSpace(chi.URLParam(r, "id"))
		runID, err := uuid.Parse(idStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid sync run id.")
			return
		}
		rows, err := d.Pool.Query(r.Context(), `
SELECT entity_type, operation, sourced_id, lextures_id::text, detail, created_at
FROM provisioning.oneroster_sync_events
WHERE run_id = $1
ORDER BY created_at ASC
LIMIT 10000
`, runID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load events.")
			return
		}
		defer rows.Close()
		type ev struct {
			EntityType string  `json:"entityType"`
			Operation  string  `json:"operation"`
			SourcedID  *string `json:"sourcedId,omitempty"`
			LexturesID *string `json:"lexturesId,omitempty"`
			Detail     *string `json:"detail,omitempty"`
			CreatedAt  string  `json:"createdAt"`
		}
		var events []ev
		for rows.Next() {
			var e ev
			var sid, lid, det *string
			var at time.Time
			if err := rows.Scan(&e.EntityType, &e.Operation, &sid, &lid, &det, &at); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to read events.")
				return
			}
			e.SourcedID, e.LexturesID, e.Detail = sid, lid, det
			e.CreatedAt = at.UTC().Format(time.RFC3339Nano)
			events = append(events, e)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"events": events})
	}
}

func (d Deps) handleAdminOneRosterBearerPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().OneRosterEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "OneRoster is not enabled.")
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		var body struct {
			InstitutionID string `json:"institutionId"`
			Label         string `json:"label"`
			Token         string `json:"token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON.")
			return
		}
		instID, err := uuid.Parse(strings.TrimSpace(body.InstitutionID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "institutionId must be a UUID.")
			return
		}
		tok := strings.TrimSpace(body.Token)
		if len(tok) < 16 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "token must be at least 16 characters.")
			return
		}
		if err := oneroster.InsertBearerCredential(r.Context(), d.Pool, instID, strings.TrimSpace(body.Label), tok); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to store credential.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

func (d Deps) handleOneRosterV1P2() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !d.effectiveConfig().OneRosterEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "OneRoster is not enabled.")
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		raw := r.Header.Get("Authorization")
		instID, err := oneroster.ResolveInstitutionFromBearer(r.Context(), d.Pool, d.effectiveConfig(), raw)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Unauthorized.")
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/oneroster/v1p2")
		path = strings.TrimSuffix(path, "/")
		ctx := r.Context()
		switch path {
		case "/users":
			if err := oneroster.WriteUsersCollectionJSON(ctx, w, d.Pool, instID); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to build response.")
			}
		case "/classes":
			if err := oneroster.WriteClassesCollectionJSON(ctx, w, d.Pool, instID); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to build response.")
			}
		case "/enrollments":
			if err := oneroster.WriteEnrollmentsCollectionJSON(ctx, w, d.Pool, instID); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to build response.")
			}
		case "/orgs":
			if err := oneroster.WriteOrgsCollectionJSON(w, instID); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to build response.")
			}
		case "/academicSessions":
			_ = oneroster.WriteEmptyJSONArrayJSON(w, "academicSessions")
		case "/gradingPeriods":
			_ = oneroster.WriteEmptyJSONArrayJSON(w, "gradingPeriods")
		default:
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeInvalidInput, "Unknown OneRoster path.")
		}
	}
}
