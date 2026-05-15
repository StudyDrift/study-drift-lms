package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/relativeschedule"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursemoduleassignments"
	"github.com/lextures/lextures/server/internal/repos/coursesections"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

// moduleAssignmentGetResponse matches `ModuleContentPageResponse` in Rust (assignment branch).
type moduleAssignmentGetResponse struct {
	ItemID                       uuid.UUID        `json:"itemId"`
	Title                        string           `json:"title"`
	Markdown                     string           `json:"markdown"`
	DueAt                        *time.Time       `json:"dueAt"`
	PointsWorth                  *int             `json:"pointsWorth,omitempty"`
	AssignmentGroupID            *uuid.UUID       `json:"assignmentGroupId,omitempty"`
	UpdatedAt                    time.Time        `json:"updatedAt"`
	AvailableFrom                *time.Time       `json:"availableFrom,omitempty"`
	AvailableUntil               *time.Time       `json:"availableUntil,omitempty"`
	RequiresAssignmentAccessCode *bool            `json:"requiresAssignmentAccessCode,omitempty"`
	AssignmentAccessCode         *string          `json:"assignmentAccessCode,omitempty"`
	SubmissionAllowText          *bool            `json:"submissionAllowText,omitempty"`
	SubmissionAllowFileUpload    *bool            `json:"submissionAllowFileUpload,omitempty"`
	SubmissionAllowURL           *bool            `json:"submissionAllowUrl,omitempty"`
	LateSubmissionPolicy         *string          `json:"lateSubmissionPolicy,omitempty"`
	LatePenaltyPercent           *int             `json:"latePenaltyPercent,omitempty"`
	Rubric                       *json.RawMessage `json:"rubric,omitempty"`
	BlindGrading                 bool             `json:"blindGrading"`
	IdentitiesRevealedAt         *time.Time       `json:"identitiesRevealedAt,omitempty"`
	ViewerCanRevealIdentities    bool             `json:"viewerCanRevealIdentities"`
	ModeratedGrading             bool             `json:"moderatedGrading"`
	ModerationThresholdPct       *int             `json:"moderationThresholdPct,omitempty"`
	ModeratorUserID              *uuid.UUID       `json:"moderatorUserId,omitempty"`
	ProvisionalGraderUserIds     *[]string        `json:"provisionalGraderUserIds,omitempty"`
	OriginalityDetection         *string          `json:"originalityDetection,omitempty"`
	OriginalityStudentVisibility *string          `json:"originalityStudentVisibility,omitempty"`
	GradingType                  *string          `json:"gradingType,omitempty"`
	PostingPolicy                *string          `json:"postingPolicy,omitempty"`
	ReleaseAt                    *time.Time       `json:"releaseAt,omitempty"`
	NeverDrop                    bool             `json:"neverDrop"`
	ReplaceWithFinal             bool             `json:"replaceWithFinal"`
}

func buildModuleAssignmentResponse(
	itemID uuid.UUID,
	row *coursemoduleassignments.CourseItemAssignmentRow,
	canEdit bool,
	shift *relativeschedule.Context,
	viewerCanReveal, showModerationDetail bool,
) moduleAssignmentGetResponse {
	due := shiftMaybe(shift, row.DueAt)
	avF := shiftMaybe(shift, row.AvailableFrom)
	avU := shiftMaybe(shift, row.AvailableUntil)
	requires := row.AssignmentAccessCode != nil && strings.TrimSpace(*row.AssignmentAccessCode) != ""
	bReq := requires
	var acc *string
	if canEdit {
		if row.AssignmentAccessCode != nil {
			if s := strings.TrimSpace(*row.AssignmentAccessCode); s != "" {
				acc = &s
			}
		}
	}
	sText := row.SubmissionAllowText
	sFile := row.SubmissionAllowFileUpload
	sURL := row.SubmissionAllowURL
	lpol := row.LateSubmissionPolicy
	od := row.OriginalityDetection
	osv := row.OriginalityStudentVisibility
	posting := row.PostingPolicy
	if posting == "" {
		posting = "automatic"
	}
	resp := moduleAssignmentGetResponse{
		ItemID:                       itemID,
		Title:                        row.Title,
		Markdown:                     row.Markdown,
		DueAt:                        due,
		PointsWorth:                  row.PointsWorth,
		AssignmentGroupID:            row.AssignmentGroupID,
		UpdatedAt:                    row.UpdatedAt,
		AvailableFrom:                avF,
		AvailableUntil:               avU,
		RequiresAssignmentAccessCode: &bReq,
		AssignmentAccessCode:         acc,
		SubmissionAllowText:          &sText,
		SubmissionAllowFileUpload:    &sFile,
		SubmissionAllowURL:           &sURL,
		LateSubmissionPolicy:         &lpol,
		LatePenaltyPercent:           row.LatePenaltyPercent,
		Rubric:                       row.OptionalRubricJSON(),
		BlindGrading:                 row.BlindGrading,
		IdentitiesRevealedAt:         row.IdentitiesRevealedAt,
		ViewerCanRevealIdentities:    viewerCanReveal && row.BlindGrading && row.IdentitiesRevealedAt == nil,
		ModeratedGrading:             showModerationDetail && row.ModeratedGrading,
		ReleaseAt:                    row.ReleaseAt,
		NeverDrop:                    row.NeverDrop,
		ReplaceWithFinal:             row.ReplaceWithFinal,
	}
	if od != "" {
		o := od
		resp.OriginalityDetection = &o
	}
	if osv != "" {
		o := osv
		resp.OriginalityStudentVisibility = &o
	}
	if row.GradingType != nil && *row.GradingType != "" {
		g := *row.GradingType
		resp.GradingType = &g
	}
	p := posting
	resp.PostingPolicy = &p
	if showModerationDetail {
		mth := row.ModerationThresholdPct
		resp.ModerationThresholdPct = &mth
		resp.ModeratorUserID = row.ModeratorUserID
		ps := make([]string, 0, len(row.ProvisionalGraderUserIDs))
		for _, u := range row.ProvisionalGraderUserIDs {
			ps = append(ps, u.String())
		}
		resp.ProvisionalGraderUserIds = &ps
	}
	return resp
}

func shiftMaybe(shift *relativeschedule.Context, t *time.Time) *time.Time {
	if shift == nil {
		return t
	}
	return shift.ShiftOpt(t)
}

// handleGetModuleAssignment is GET /api/v1/courses/{course_code}/assignments/{item_id}.
func (d Deps) handleGetModuleAssignment() http.HandlerFunc {
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
			visible, err := coursestructure.AssignmentVisibleToStudent(
				r.Context(), d.Pool, *cid, itemID, viewer, time.Now().UTC(),
			)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check assignment access.")
				return
			}
			if !visible {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
		}
		row, err := coursemoduleassignments.GetForCourseItem(r.Context(), d.Pool, *cid, itemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load assignment.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		disp := *row
		if !canEdit {
			crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
			if err == nil && crow != nil && crow.SectionsEnabled {
				secID, err := enrollment.GetStudentSectionID(r.Context(), d.Pool, *cid, viewer)
				if err == nil && secID != nil {
					ov, err := coursesections.GetOverride(r.Context(), d.Pool, *secID, itemID)
					if err == nil && ov != nil {
						if ov.DueAt != nil {
							disp.DueAt = ov.DueAt
						}
						if ov.AvailableFrom != nil {
							disp.AvailableFrom = ov.AvailableFrom
						}
						if ov.AvailableUntil != nil {
							disp.AvailableUntil = ov.AvailableUntil
						}
					}
				}
			}
		}
		var shift *relativeschedule.Context
		if !canEdit {
			shift, err = relativeschedule.LoadForUser(r.Context(), d.Pool, *cid, viewer)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course schedule.")
				return
			}
		}
		viewerCanReveal, err := enrollment.UserIsCourseCreator(r.Context(), d.Pool, courseCode, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check course creator.")
			return
		}
		showMod := canEdit
		if !showMod {
			showMod, err = enrollment.UserIsCourseStaff(r.Context(), d.Pool, courseCode, viewer)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check course staff.")
				return
			}
		}
		out := buildModuleAssignmentResponse(
			itemID, &disp, canEdit, shift, viewerCanReveal, showMod,
		)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handlePatchModuleAssignment is PATCH /api/v1/courses/{course_code}/assignments/{item_id}.
// Full assignment write parity is in progress; this validates access and returns current assignment payload.
func (d Deps) handlePatchModuleAssignment() http.HandlerFunc {
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
			Markdown                     string           `json:"markdown"`
			DueAt                        *time.Time       `json:"dueAt"`
			PointsWorth                  *int             `json:"pointsWorth"`
			AssignmentGroupID            *uuid.UUID       `json:"assignmentGroupId"`
			AvailableFrom                *time.Time       `json:"availableFrom"`
			AvailableUntil               *time.Time       `json:"availableUntil"`
			AssignmentAccessCode         *string          `json:"assignmentAccessCode"`
			SubmissionAllowText          *bool            `json:"submissionAllowText"`
			SubmissionAllowFileUpload    *bool            `json:"submissionAllowFileUpload"`
			SubmissionAllowURL           *bool            `json:"submissionAllowUrl"`
			LateSubmissionPolicy         string           `json:"lateSubmissionPolicy"`
			LatePenaltyPercent           *int             `json:"latePenaltyPercent"`
			Rubric                       *json.RawMessage `json:"rubric"`
			BlindGrading                 bool             `json:"blindGrading"`
			ModeratedGrading             bool             `json:"moderatedGrading"`
			ModerationThresholdPct       int              `json:"moderationThresholdPct"`
			ModeratorUserID              *uuid.UUID       `json:"moderatorUserId"`
			ProvisionalGraderUserIDs     []string         `json:"provisionalGraderUserIds"`
			OriginalityDetection         string           `json:"originalityDetection"`
			OriginalityStudentVisibility string           `json:"originalityStudentVisibility"`
			GradingType                  *string          `json:"gradingType"`
			PostingPolicy                string           `json:"postingPolicy"`
			ReleaseAt                    *time.Time       `json:"releaseAt"`
			NeverDrop                    bool             `json:"neverDrop"`
			ReplaceWithFinal             bool             `json:"replaceWithFinal"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
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
		policy := strings.TrimSpace(req.LateSubmissionPolicy)
		if policy == "" {
			policy = "allow"
		}
		if policy != "allow" && policy != "penalty" && policy != "block" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid lateSubmissionPolicy.")
			return
		}
		posting := strings.TrimSpace(req.PostingPolicy)
		if posting == "" {
			posting = "automatic"
		}
		if posting != "automatic" && posting != "manual" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid postingPolicy.")
			return
		}
		origDet := strings.TrimSpace(req.OriginalityDetection)
		if origDet == "" {
			origDet = "disabled"
		}
		origVis := strings.TrimSpace(req.OriginalityStudentVisibility)
		if origVis == "" {
			origVis = "hide"
		}
		var gtype *string
		if req.GradingType != nil {
			t := strings.TrimSpace(*req.GradingType)
			if t != "" {
				gtype = &t
			}
		}
		var accessCode *string
		if req.AssignmentAccessCode != nil {
			t := strings.TrimSpace(*req.AssignmentAccessCode)
			if t != "" {
				accessCode = &t
			}
		}
		prov := make([]uuid.UUID, 0, len(req.ProvisionalGraderUserIDs))
		for _, s := range req.ProvisionalGraderUserIDs {
			u, err := uuid.Parse(strings.TrimSpace(s))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid provisionalGraderUserIds.")
				return
			}
			prov = append(prov, u)
		}
		okWrite, err := coursemoduleassignments.PatchForCourseItem(r.Context(), d.Pool, *cid, itemID, coursemoduleassignments.PatchWrite{
			Markdown:                     req.Markdown,
			DueAt:                        req.DueAt,
			PointsWorth:                  req.PointsWorth,
			AssignmentGroupID:            req.AssignmentGroupID,
			AvailableFrom:                req.AvailableFrom,
			AvailableUntil:               req.AvailableUntil,
			AssignmentAccessCode:         accessCode,
			SubmissionAllowText:          req.SubmissionAllowText,
			SubmissionAllowFileUpload:    req.SubmissionAllowFileUpload,
			SubmissionAllowURL:           req.SubmissionAllowURL,
			LateSubmissionPolicy:         policy,
			LatePenaltyPercent:           req.LatePenaltyPercent,
			RubricJSON:                   req.Rubric,
			BlindGrading:                 req.BlindGrading,
			ModeratedGrading:             req.ModeratedGrading,
			ModerationThresholdPct:       req.ModerationThresholdPct,
			ModeratorUserID:              req.ModeratorUserID,
			ProvisionalGraderUserIDs:     prov,
			OriginalityDetection:         origDet,
			OriginalityStudentVisibility: origVis,
			GradingType:                  gtype,
			PostingPolicy:                posting,
			ReleaseAt:                    req.ReleaseAt,
			NeverDrop:                    req.NeverDrop,
			ReplaceWithFinal:             req.ReplaceWithFinal,
		})
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save assignment.")
			return
		}
		if !okWrite {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		row, err := coursemoduleassignments.GetForCourseItem(r.Context(), d.Pool, *cid, itemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load assignment.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		viewerCanReveal, err := enrollment.UserIsCourseCreator(r.Context(), d.Pool, courseCode, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check course creator.")
			return
		}
		out := buildModuleAssignmentResponse(itemID, row, true, nil, viewerCanReveal, true)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}
