package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	pp "github.com/lextures/lextures/server/internal/auth/passwordpolicy"
	"github.com/lextures/lextures/server/internal/repos/passwordpolicy"
)

type adminPasswordPolicyBody struct {
	MinLength      *int  `json:"minLength"`
	RequireUpper   *bool `json:"requireUpper"`
	RequireLower   *bool `json:"requireLower"`
	RequireDigit   *bool `json:"requireDigit"`
	RequireSpecial *bool `json:"requireSpecial"`
	CheckHIBP      *bool `json:"checkHibp"`
}

func (d Deps) handleAdminPasswordPolicyGet() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		instStr := strings.TrimSpace(r.URL.Query().Get("institutionId"))
		var row passwordpolicy.Row
		var err error
		var requestedInst *string
		if instStr != "" {
			instID, perr := uuid.Parse(instStr)
			if perr != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid institutionId.")
				return
			}
			s := instID.String()
			requestedInst = &s
			row, err = passwordpolicy.LoadEffective(r.Context(), d.Pool, &instID)
		} else {
			row, err = passwordpolicy.LoadGlobal(r.Context(), d.Pool)
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load password policy.")
			return
		}
		pol := pp.FromDBRow(row)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		instOut := requestedInst
		if instOut == nil && row.InstitutionID != nil {
			s := row.InstitutionID.String()
			instOut = &s
		}
		_ = json.NewEncoder(w).Encode(struct {
			InstitutionID  *string `json:"institutionId"`
			MinLength      int     `json:"minLength"`
			RequireUpper   bool    `json:"requireUpper"`
			RequireLower   bool    `json:"requireLower"`
			RequireDigit   bool    `json:"requireDigit"`
			RequireSpecial bool    `json:"requireSpecial"`
			CheckHIBP      bool    `json:"checkHibp"`
		}{
			InstitutionID:  instOut,
			MinLength:      pol.MinLength,
			RequireUpper:   pol.RequireUpper,
			RequireLower:   pol.RequireLower,
			RequireDigit:   pol.RequireDigit,
			RequireSpecial: pol.RequireSpecial,
			CheckHIBP:      pol.CheckHIBP,
		})
	}
}

func (d Deps) handleAdminPasswordPolicyPut() http.HandlerFunc {
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
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInvalidInput, "Database is not configured.")
			return
		}
		var b adminPasswordPolicyBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		instStr := strings.TrimSpace(r.URL.Query().Get("institutionId"))
		base, err := passwordpolicy.LoadGlobal(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load global password policy.")
			return
		}
		next := base
		if b.MinLength != nil {
			if *b.MinLength < 8 || *b.MinLength > 256 {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "minLength must be between 8 and 256.")
				return
			}
			next.MinLength = *b.MinLength
		}
		if b.RequireUpper != nil {
			next.RequireUpper = *b.RequireUpper
		}
		if b.RequireLower != nil {
			next.RequireLower = *b.RequireLower
		}
		if b.RequireDigit != nil {
			next.RequireDigit = *b.RequireDigit
		}
		if b.RequireSpecial != nil {
			next.RequireSpecial = *b.RequireSpecial
		}
		if b.CheckHIBP != nil {
			next.CheckHIBP = *b.CheckHIBP
		}
		if instStr == "" {
			if err := passwordpolicy.UpdateGlobalPolicy(r.Context(), d.Pool, next); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not save password policy.")
				return
			}
		} else {
			instID, perr := uuid.Parse(instStr)
			if perr != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid institutionId.")
				return
			}
			next.InstitutionID = &instID
			if err := passwordpolicy.UpsertInstitutionPolicy(r.Context(), d.Pool, instID, next); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not save password policy.")
				return
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}
