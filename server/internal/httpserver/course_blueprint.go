package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/service/blueprintsync"
)

func (d Deps) requireCourseBlueprintOrgAdmin(
	w http.ResponseWriter, r *http.Request, courseOrgID uuid.UUID,
) (actor uuid.UUID, ok bool) {
	actor, ok = d.meUserID(w, r)
	if !ok {
		return uuid.UUID{}, false
	}
	ctx := r.Context()
	ga, err := rbac.UserHasPermission(ctx, d.Pool, actor, permGlobalRBACManage)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.UUID{}, false
	}
	if ga {
		return actor, true
	}
	uOrg, err := organization.OrgIDForUser(ctx, d.Pool, actor)
	if err != nil || uOrg != courseOrgID {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return uuid.UUID{}, false
	}
	has, err := rbac.UserHasPermission(ctx, d.Pool, actor, permTenantOrgUnitsAdmin)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.UUID{}, false
	}
	if !has {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return uuid.UUID{}, false
	}
	return actor, true
}

func (d Deps) userCanManageBlueprintLocks(ctx context.Context, viewer, courseOrgID uuid.UUID) bool {
	ga, err := rbac.UserHasPermission(ctx, d.Pool, viewer, permGlobalRBACManage)
	if err == nil && ga {
		return true
	}
	uOrg, err := organization.OrgIDForUser(ctx, d.Pool, viewer)
	if err != nil || uOrg != courseOrgID {
		return false
	}
	ok, err := rbac.UserHasPermission(ctx, d.Pool, viewer, permTenantOrgUnitsAdmin)
	return err == nil && ok
}

func blueprintAncestorsInclude(ctx context.Context, pool *pgxpool.Pool, start, candidate uuid.UUID) (bool, error) {
	cur := start
	seen := make(map[uuid.UUID]struct{})
	for range 64 {
		if cur == candidate {
			return true, nil
		}
		if _, ok := seen[cur]; ok {
			return false, nil
		}
		seen[cur] = struct{}{}
		m, err := course.GetBlueprintMeta(ctx, pool, cur)
		if err != nil {
			return false, err
		}
		if m.BlueprintParentID == nil {
			return false, nil
		}
		cur = *m.BlueprintParentID
	}
	return true, nil
}

// handlePatchCourseBlueprint is PATCH /api/v1/courses/{course_code}/blueprint — set isBlueprint flag.
func (d Deps) handlePatchCourseBlueprint() http.HandlerFunc {
	type body struct {
		IsBlueprint bool `json:"isBlueprint"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, _, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		meta, err := course.GetBlueprintMeta(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if _, ok := d.requireCourseBlueprintOrgAdmin(w, r, meta.OrgID); !ok {
			return
		}
		var b body
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if err := course.SetCourseIsBlueprint(r.Context(), d.Pool, *cid, b.IsBlueprint); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update blueprint flag.")
			return
		}
		out, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || out == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleGetCourseBlueprintChildren is GET /api/v1/courses/{course_code}/blueprint/children.
func (d Deps) handleGetCourseBlueprintChildren() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, _, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		meta, err := course.GetBlueprintMeta(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if _, ok := d.requireCourseBlueprintOrgAdmin(w, r, meta.OrgID); !ok {
			return
		}
		kids, err := course.ListBlueprintChildren(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list child courses.")
			return
		}
		type row struct {
			CourseCode string     `json:"courseCode"`
			Title      string     `json:"title"`
			LastSyncAt *time.Time `json:"lastSyncAt,omitempty"`
		}
		out := make([]row, 0, len(kids))
		for _, k := range kids {
			out = append(out, row{
				CourseCode: k.CourseCode,
				Title:      k.Title,
				LastSyncAt: k.LastSync,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"children": out})
	}
}

// handlePostCourseBlueprintChild is POST /api/v1/courses/{course_code}/blueprint/children.
func (d Deps) handlePostCourseBlueprintChild() http.HandlerFunc {
	type body struct {
		ChildCourseCode string `json:"childCourseCode"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		bpCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		bpID, err := course.GetIDByCourseCode(r.Context(), d.Pool, bpCode)
		if err != nil || bpID == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		bpMeta, err := course.GetBlueprintMeta(r.Context(), d.Pool, *bpID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if _, ok := d.requireCourseBlueprintOrgAdmin(w, r, bpMeta.OrgID); !ok {
			return
		}
		if !bpMeta.IsBlueprint {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Designate this course as a blueprint before linking children.")
			return
		}
		var b body
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		childCode := strings.TrimSpace(b.ChildCourseCode)
		if childCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "childCourseCode is required.")
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, childCode, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Child course not found.")
			return
		}
		childID, err := course.GetIDByCourseCode(r.Context(), d.Pool, childCode)
		if err != nil || childID == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load child course.")
			return
		}
		if *childID == *bpID {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "A course cannot be linked as its own blueprint child.")
			return
		}
		under, err := blueprintAncestorsInclude(r.Context(), d.Pool, *bpID, *childID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to validate blueprint relationship.")
			return
		}
		if under {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Circular blueprint relationship blocked.")
			return
		}
		if err := blueprintsync.LinkChildCourse(r.Context(), d.Pool, *bpID, *childID); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "linked"})
	}
}

// handleDeleteCourseBlueprintChild is DELETE /api/v1/courses/{course_code}/blueprint/children/{child_course_code}.
func (d Deps) handleDeleteCourseBlueprintChild() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		bpCode, _, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		bpID, err := course.GetIDByCourseCode(r.Context(), d.Pool, bpCode)
		if err != nil || bpID == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		bpMeta, err := course.GetBlueprintMeta(r.Context(), d.Pool, *bpID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if _, ok := d.requireCourseBlueprintOrgAdmin(w, r, bpMeta.OrgID); !ok {
			return
		}
		childCode := strings.TrimSpace(chi.URLParam(r, "child_course_code"))
		if childCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing child course code.")
			return
		}
		childID, err := course.GetIDByCourseCode(r.Context(), d.Pool, childCode)
		if err != nil || childID == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Child course not found.")
			return
		}
		chMeta, err := course.GetBlueprintMeta(r.Context(), d.Pool, *childID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load child course.")
			return
		}
		if chMeta.BlueprintParentID == nil || *chMeta.BlueprintParentID != *bpID {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "This course is not linked to this blueprint.")
			return
		}
		if err := course.ClearBlueprintParent(r.Context(), d.Pool, *childID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to unlink course.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handlePostCourseBlueprintPush is POST /api/v1/courses/{course_code}/blueprint/push.
func (d Deps) handlePostCourseBlueprintPush() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		bpCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		bpID, err := course.GetIDByCourseCode(r.Context(), d.Pool, bpCode)
		if err != nil || bpID == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		bpMeta, err := course.GetBlueprintMeta(r.Context(), d.Pool, *bpID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if _, ok := d.requireCourseBlueprintOrgAdmin(w, r, bpMeta.OrgID); !ok {
			return
		}
		if !bpMeta.IsBlueprint {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Course is not a blueprint.")
			return
		}
		total, okN, errN, detail, err := blueprintsync.PushToAllChildren(r.Context(), d.Pool, *bpID, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Blueprint push failed.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"childrenTotal":    total,
			"childrenSuccess": okN,
			"childrenError":    errN,
			"detail":           detail,
		})
	}
}

type blueprintSyncLogRow struct {
	ID             uuid.UUID       `json:"id"`
	TriggeredBy    uuid.UUID       `json:"triggeredBy"`
	TriggeredAt    time.Time       `json:"triggeredAt"`
	ChildrenTotal  int             `json:"childrenTotal"`
	ChildrenOK     int             `json:"childrenSuccess"`
	ChildrenErr    int             `json:"childrenError"`
	LogDetail      json.RawMessage `json:"logDetail"`
}

// handleGetCourseBlueprintSyncLogs is GET /api/v1/courses/{course_code}/blueprint/sync-logs.
func (d Deps) handleGetCourseBlueprintSyncLogs() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		bpCode, _, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		bpID, err := course.GetIDByCourseCode(r.Context(), d.Pool, bpCode)
		if err != nil || bpID == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		bpMeta, err := course.GetBlueprintMeta(r.Context(), d.Pool, *bpID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if _, ok := d.requireCourseBlueprintOrgAdmin(w, r, bpMeta.OrgID); !ok {
			return
		}
		rows, err := d.Pool.Query(r.Context(), `
			SELECT id, triggered_by, triggered_at, children_total, children_success, children_error, log_detail
			FROM course.blueprint_sync_logs
			WHERE blueprint_id = $1
			ORDER BY triggered_at DESC
			LIMIT 50
		`, *bpID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load sync logs.")
			return
		}
		defer rows.Close()
		var logs []blueprintSyncLogRow
		for rows.Next() {
			var lr blueprintSyncLogRow
			var detail []byte
			if err := rows.Scan(&lr.ID, &lr.TriggeredBy, &lr.TriggeredAt, &lr.ChildrenTotal, &lr.ChildrenOK, &lr.ChildrenErr, &detail); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load sync logs.")
				return
			}
			if len(detail) > 0 {
				lr.LogDetail = append(json.RawMessage(nil), detail...)
			} else {
				lr.LogDetail = json.RawMessage("[]")
			}
			logs = append(logs, lr)
		}
		if err := rows.Err(); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load sync logs.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"logs": logs})
	}
}
