package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/orgunit"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

const permTenantOrgUnitsAdmin = "tenant:org:units:admin"

// adminOrgOrUnitAccess ensures caller is global RBAC admin or org-scoped org-unit admin for orgID.
func (d Deps) adminOrgOrUnitAccess(w http.ResponseWriter, r *http.Request, orgID uuid.UUID) (actorID uuid.UUID, global bool, ok bool) {
	actorID, ok = d.meUserID(w, r)
	if !ok {
		return uuid.UUID{}, false, false
	}
	ctx := r.Context()
	ga, err := rbac.UserHasPermission(ctx, d.Pool, actorID, permGlobalRBACManage)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.UUID{}, false, false
	}
	if ga {
		return actorID, true, true
	}
	uOrg, err := organization.OrgIDForUser(ctx, d.Pool, actorID)
	if err != nil || uOrg != orgID {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return uuid.UUID{}, false, false
	}
	has, err := rbac.UserHasPermission(ctx, d.Pool, actorID, permTenantOrgUnitsAdmin)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.UUID{}, false, false
	}
	if !has {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return uuid.UUID{}, false, false
	}
	return actorID, false, true
}

func (d Deps) unitAdminAllowedSubtree(ctx context.Context, userID, orgID uuid.UUID) ([]uuid.UUID, error) {
	return orgunit.ListSubtreeIDsForUserOrgUnitAdmin(ctx, d.Pool, userID, orgID)
}

func (d Deps) unitInAllowedSubtree(unitID uuid.UUID, allowed []uuid.UUID) bool {
	for _, a := range allowed {
		if a == unitID {
			return true
		}
	}
	return false
}

type postOrgUnitBody struct {
	Name         string          `json:"name"`
	UnitType     string          `json:"unitType"`
	ParentUnitID *string         `json:"parentUnitId"`
	Metadata     json.RawMessage `json:"metadata"`
}

type patchOrgUnitBody struct {
	Name         *string         `json:"name"`
	UnitType     *string         `json:"unitType"`
	Status       *string         `json:"status"`
	ParentUnitID *string         `json:"parentUnitId"`
	Metadata     *json.RawMessage `json:"metadata"`
}

func rowToOrgUnitJSON(r orgunit.Row) map[string]any {
	meta := r.Metadata
	if len(meta) == 0 {
		meta = []byte("{}")
	}
	out := map[string]any{
		"id":               r.ID.String(),
		"orgId":            r.OrgID.String(),
		"name":             r.Name,
		"unitType":         r.UnitType,
		"status":           r.Status,
		"metadata":         meta,
		"childCourseCount": r.ChildCourseCnt,
		"createdAt":        r.CreatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z07:00"),
		"updatedAt":        r.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z07:00"),
	}
	if r.ParentUnitID != nil {
		out["parentUnitId"] = r.ParentUnitID.String()
	} else {
		out["parentUnitId"] = nil
	}
	return out
}

func (d Deps) handleAdminOrgUnitsCollection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		_, global, ok := d.adminOrgOrUnitAccess(w, r, orgID)
		if !ok {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			rows, err := orgunit.ListByOrg(ctx, d.Pool, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list org units.")
				return
			}
			list := make([]map[string]any, 0, len(rows))
			for _, row := range rows {
				list = append(list, rowToOrgUnitJSON(row))
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{"units": list})
		case http.MethodPost:
			if !global {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only a platform admin can create root units.")
				return
			}
			var body postOrgUnitBody
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			ut := strings.TrimSpace(body.UnitType)
			if ut == "" {
				ut = "other"
			}
			var parent *uuid.UUID
			if body.ParentUnitID != nil && strings.TrimSpace(*body.ParentUnitID) != "" {
				pid, err := uuid.Parse(strings.TrimSpace(*body.ParentUnitID))
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid parentUnitId.")
					return
				}
				parent = &pid
			}
			meta := body.Metadata
			if len(meta) == 0 {
				meta = []byte("{}")
			}
			row, err := orgunit.Create(ctx, d.Pool, orgID, parent, body.Name, ut, meta)
			if err != nil {
				if strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "mismatch") {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create org unit.")
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(rowToOrgUnitJSON(*row))
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

func (d Deps) handleAdminOrgUnitsTree() http.HandlerFunc {
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
		if _, _, ok := d.adminOrgOrUnitAccess(w, r, orgID); !ok {
			return
		}
		rows, err := orgunit.ListByOrg(r.Context(), d.Pool, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load org units.")
			return
		}
		tree := orgunit.BuildTree(rows)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"tree": tree})
	}
}

func (d Deps) handleAdminOrgUnitItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		uidStr := strings.TrimSpace(chi.URLParam(r, "unitId"))
		unitID, err := uuid.Parse(uidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid unit id.")
			return
		}
		actorID, global, ok := d.adminOrgOrUnitAccess(w, r, orgID)
		if !ok {
			return
		}
		ctx := r.Context()
		row, err := orgunit.GetByID(ctx, d.Pool, unitID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load org unit.")
			return
		}
		if row == nil || row.OrgID != orgID {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var allowed []uuid.UUID
		if !global {
			allowed, err = d.unitAdminAllowedSubtree(ctx, actorID, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify unit scope.")
				return
			}
			if !d.unitInAllowedSubtree(unitID, allowed) {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
				return
			}
		}
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(rowToOrgUnitJSON(*row))
		case http.MethodPatch:
			b, _ := io.ReadAll(r.Body)
			_ = r.Body.Close()
			var body patchOrgUnitBody
			if len(b) > 0 {
				if err := json.Unmarshal(b, &body); err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
					return
				}
			}
			if body.ParentUnitID != nil && !global {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only a platform admin can change unit parentage.")
				return
			}
			var parentPtr **uuid.UUID
			if body.ParentUnitID != nil {
				s := strings.TrimSpace(*body.ParentUnitID)
				if s == "" {
					var nilP *uuid.UUID
					parentPtr = &nilP
				} else {
					pid, err := uuid.Parse(s)
					if err != nil {
						apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid parentUnitId.")
						return
					}
					p := pid
					pp := &p
					parentPtr = &pp
				}
			}
			var meta *[]byte
			if body.Metadata != nil {
				m := []byte(*body.Metadata)
				meta = &m
			}
			updated, err := orgunit.Update(ctx, d.Pool, unitID, body.Name, body.UnitType, body.Status, meta, parentPtr)
			if err != nil {
				if strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "mismatch") || strings.Contains(err.Error(), "cannot") {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update org unit.")
				return
			}
			if updated == nil {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(rowToOrgUnitJSON(*updated))
		case http.MethodDelete:
			if !global {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only a platform admin can delete org units.")
				return
			}
			if err := orgunit.Delete(ctx, d.Pool, unitID); err != nil {
				if strings.HasPrefix(err.Error(), "blocked:") {
					apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, strings.TrimPrefix(err.Error(), "blocked: "))
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete org unit.")
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPatch, http.MethodDelete}, ", "))
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

type postOrgUnitChildBody struct {
	Name     string          `json:"name"`
	UnitType string          `json:"unitType"`
	Metadata json.RawMessage `json:"metadata"`
}

func (d Deps) handleAdminOrgUnitChildren() http.HandlerFunc {
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
		uidStr := strings.TrimSpace(chi.URLParam(r, "unitId"))
		parentID, err := uuid.Parse(uidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid unit id.")
			return
		}
		actorID, global, ok := d.adminOrgOrUnitAccess(w, r, orgID)
		if !ok {
			return
		}
		ctx := r.Context()
		parentRow, err := orgunit.GetByID(ctx, d.Pool, parentID)
		if err != nil || parentRow == nil || parentRow.OrgID != orgID {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if !global {
			allowed, err := d.unitAdminAllowedSubtree(ctx, actorID, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify unit scope.")
				return
			}
			if !d.unitInAllowedSubtree(parentID, allowed) {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
				return
			}
		}
		var body postOrgUnitChildBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		ut := strings.TrimSpace(body.UnitType)
		if ut == "" {
			ut = "other"
		}
		meta := body.Metadata
		if len(meta) == 0 {
			meta = []byte("{}")
		}
		pp := parentID
		row, err := orgunit.Create(ctx, d.Pool, orgID, &pp, body.Name, ut, meta)
		if err != nil {
			if strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "mismatch") {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create org unit.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(rowToOrgUnitJSON(*row))
	}
}

type postOrgUnitAdminBody struct {
	UserID string `json:"userId"`
}

func (d Deps) handleAdminOrgUnitAssignAdmin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		uidStr := strings.TrimSpace(chi.URLParam(r, "unitId"))
		unitID, err := uuid.Parse(uidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid unit id.")
			return
		}
		ctx := r.Context()
		row, err := orgunit.GetByID(ctx, d.Pool, unitID)
		if err != nil || row == nil || row.OrgID != orgID {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var body postOrgUnitAdminBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		targetUser, err := uuid.Parse(strings.TrimSpace(body.UserID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid userId.")
			return
		}
		var targetOrg uuid.UUID
		err = d.Pool.QueryRow(ctx, `SELECT org_id FROM "user".users WHERE id = $1`, targetUser).Scan(&targetOrg)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "User not found.")
			return
		}
		if targetOrg != orgID {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "User must belong to the same organization.")
			return
		}
		if err := orgunit.AssignOrgUnitAdmin(ctx, d.Pool, targetUser, unitID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to assign org unit admin.")
			return
		}
		if err := rbac.AssignUserRoleByName(ctx, d.Pool, targetUser, "Org Unit Admin"); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to assign role.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

type patchCourseOrgUnitBody struct {
	OrgUnitID *string `json:"orgUnitId"`
}

func (d Deps) handleAdminOrgCourseOrgUnit() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.adminRbacUser(w, r); !ok {
			return
		}
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		courseCode := strings.TrimSpace(chi.URLParam(r, "courseCode"))
		if courseCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
			return
		}
		var body patchCourseOrgUnitBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		ctx := r.Context()
		var cid uuid.UUID
		var cOrg uuid.UUID
		err = d.Pool.QueryRow(ctx, `SELECT id, org_id FROM course.courses WHERE course_code = $1`, courseCode).Scan(&cid, &cOrg)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		if cOrg != orgID {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		var unitArg any
		if body.OrgUnitID == nil || strings.TrimSpace(*body.OrgUnitID) == "" {
			unitArg = nil
		} else {
			uid, err := uuid.Parse(strings.TrimSpace(*body.OrgUnitID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid orgUnitId.")
				return
			}
			ur, err := orgunit.GetByID(ctx, d.Pool, uid)
			if err != nil || ur == nil || ur.OrgID != orgID {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid org unit.")
				return
			}
			unitArg = uid
		}
		if _, err := d.Pool.Exec(ctx, `UPDATE course.courses SET org_unit_id = $2 WHERE id = $1`, cid, unitArg); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update course.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}
