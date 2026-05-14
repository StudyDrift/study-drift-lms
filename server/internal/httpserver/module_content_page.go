package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/relativeschedule"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursemodulecontent"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

type dueAtPatchMode uint8

const (
	dueAtPatchOmit dueAtPatchMode = iota
	dueAtPatchClear
	dueAtPatchSet
)

func parseDueAtJSON(raw json.RawMessage) (dueAtPatchMode, time.Time, error) {
	if len(raw) == 0 {
		return dueAtPatchOmit, time.Time{}, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return dueAtPatchOmit, time.Time{}, err
	}
	if v == nil {
		return dueAtPatchClear, time.Time{}, nil
	}
	s, ok := v.(string)
	if !ok {
		return dueAtPatchOmit, time.Time{}, fmt.Errorf("dueAt must be a string or null")
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t, err = time.Parse(time.RFC3339, s)
	}
	if err != nil {
		return dueAtPatchOmit, time.Time{}, err
	}
	return dueAtPatchSet, t.UTC(), nil
}

func buildModuleContentPageGetResponse(itemID uuid.UUID, row *coursemodulecontent.CourseItemContentRow, shift *relativeschedule.Context) moduleAssignmentGetResponse {
	bFalse := false
	sText := true
	sFile := false
	sURL := false
	lpol := "allow"
	posting := "automatic"
	return moduleAssignmentGetResponse{
		ItemID:                       itemID,
		Title:                        row.Title,
		Markdown:                     row.Markdown,
		DueAt:                        shiftMaybe(shift, row.DueAt),
		UpdatedAt:                    row.UpdatedAt,
		RequiresAssignmentAccessCode: &bFalse,
		SubmissionAllowText:          &sText,
		SubmissionAllowFileUpload:    &sFile,
		SubmissionAllowURL:           &sURL,
		LateSubmissionPolicy:         &lpol,
		BlindGrading:                 false,
		ViewerCanRevealIdentities:    false,
		ModeratedGrading:             false,
		NeverDrop:                    false,
		ReplaceWithFinal:             false,
		PostingPolicy:                &posting,
	}
}

// handleGetModuleContentPage is GET /api/v1/courses/{course_code}/content-pages/{item_id}.
func (d Deps) handleGetModuleContentPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "item_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid item id.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		perm := "course:" + courseCode + ":item:create"
		canEdit, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canEdit {
			visible, err := coursestructure.ContentPageVisibleToStudent(
				r.Context(), d.Pool, *cid, itemID, viewer, time.Now().UTC(),
			)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check content page access.")
				return
			}
			if !visible {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
		}
		row, err := coursemodulecontent.GetForCourseItem(r.Context(), d.Pool, *cid, itemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load content page.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var shift *relativeschedule.Context
		if !canEdit {
			shift, err = relativeschedule.LoadForUser(r.Context(), d.Pool, *cid, viewer)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course schedule.")
				return
			}
		}
		out := buildModuleContentPageGetResponse(itemID, row, shift)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handlePatchModuleContentPage is PATCH /api/v1/courses/{course_code}/content-pages/{item_id}.
func (d Deps) handlePatchModuleContentPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "item_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid item id.")
			return
		}
		perm := "course:" + courseCode + ":item:create"
		canEdit, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canEdit {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		var req struct {
			Markdown string          `json:"markdown"`
			DueAt    json.RawMessage `json:"dueAt"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		dueMode, dueVal, err := parseDueAtJSON(req.DueAt)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		locked, found, err := coursestructure.ItemBlueprintLockState(r.Context(), d.Pool, *cid, itemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify structure item.")
			return
		}
		if found && locked {
			cOrg, err := course.CourseOrgID(r.Context(), d.Pool, courseCode)
			if err != nil || cOrg == nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course.")
				return
			}
			if !d.userCanManageBlueprintLocks(r.Context(), viewer, *cOrg) {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "This item is managed by the district blueprint.")
				return
			}
		}
		var touchDue bool
		var duePtr *time.Time
		switch dueMode {
		case dueAtPatchOmit:
			touchDue = false
		case dueAtPatchClear:
			touchDue = true
			duePtr = nil
		case dueAtPatchSet:
			touchDue = true
			duePtr = &dueVal
		}
		row, err := coursemodulecontent.PatchContentPage(r.Context(), d.Pool, *cid, itemID, req.Markdown, touchDue, duePtr)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save content page.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		out := buildModuleContentPageGetResponse(itemID, row, nil)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}
