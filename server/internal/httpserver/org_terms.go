package httpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/terms"
)

type termsCollectionResponse struct {
	Terms []terms.TermPublic `json:"terms"`
}

func (d Deps) handleOrgTermsPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		_, _, ok := d.adminOrgOrUnitAccess(w, r, orgID)
		if !ok {
			return
		}
		ctx := r.Context()
		var body struct {
			Name     string `json:"name"`
			TermType string `json:"termType"`
			Start    string `json:"startDate"`
			End      string `json:"endDate"`
			Status   string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		t, err := terms.Create(ctx, d.Pool, orgID, body.Name, body.TermType, body.Start, body.End, body.Status)
		if err != nil {
			switch err {
			case terms.ErrInvalidTermType, terms.ErrInvalidTermStatus, terms.ErrInvalidDateRange:
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			default:
				if strings.Contains(err.Error(), "required") {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create term.")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(t)
	}
}

func (d Deps) handleOrgTermPatch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		tidStr := strings.TrimSpace(chi.URLParam(r, "tid"))
		tid, err := uuid.Parse(tidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid term id.")
			return
		}
		_, _, ok := d.adminOrgOrUnitAccess(w, r, orgID)
		if !ok {
			return
		}
		ctx := r.Context()
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var body struct {
			Name     *string `json:"name"`
			TermType *string `json:"termType"`
			Start    *string `json:"startDate"`
			End      *string `json:"endDate"`
			Status   *string `json:"status"`
		}
		if len(b) > 0 {
			if err := json.Unmarshal(b, &body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
		}
		t, err := terms.Patch(ctx, d.Pool, orgID, tid, body.Name, body.TermType, body.Start, body.End, body.Status)
		if err != nil {
			switch err {
			case terms.ErrTermNotFound:
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			case terms.ErrTermWrongOrg:
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Wrong organization.")
			case terms.ErrInvalidTermType, terms.ErrInvalidTermStatus, terms.ErrInvalidDateRange:
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			default:
				if strings.Contains(err.Error(), "required") {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update term.")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(t)
	}
}

func (d Deps) handleOrgTermDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		tidStr := strings.TrimSpace(chi.URLParam(r, "tid"))
		tid, err := uuid.Parse(tidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid term id.")
			return
		}
		_, _, ok := d.adminOrgOrUnitAccess(w, r, orgID)
		if !ok {
			return
		}
		ctx := r.Context()
		err = terms.Delete(ctx, d.Pool, orgID, tid)
		if err != nil {
			switch err {
			case terms.ErrTermNotFound:
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			case terms.ErrTermWrongOrg:
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Wrong organization.")
			case terms.ErrTermHasCourses:
				apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, "Cannot delete a term that still has courses.")
			default:
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete term.")
			}
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleAdminOrgTermsList is GET /api/v1/admin/orgs/{orgId}/terms (platform admin).
func (d Deps) handleAdminOrgTermsList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		_, ok := d.adminRbacUser(w, r)
		if !ok {
			return
		}
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		list, err := terms.ListByOrg(r.Context(), d.Pool, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list terms.")
			return
		}
		if list == nil {
			list = []terms.TermPublic{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(termsCollectionResponse{Terms: list})
	}
}
func (d Deps) handleOrgTermsRead() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		uOrg, err := organization.OrgIDForUser(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify organization.")
			return
		}
		if uOrg != orgID {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have access to this organization.")
			return
		}
		list, err := terms.ListByOrg(ctx, d.Pool, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list terms.")
			return
		}
		if list == nil {
			list = []terms.TermPublic{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(termsCollectionResponse{Terms: list})
	}
}
