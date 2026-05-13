package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/courseroles"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	ltidb "github.com/lextures/lextures/server/internal/repos/lti"
)

func parseRFC3339Timestamp(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, errors.New("empty timestamp")
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, s)
}

func (d Deps) guardCourseItemCreateBlueprint(
	w http.ResponseWriter,
	r *http.Request,
	courseCode string,
	viewer uuid.UUID,
	courseID uuid.UUID,
	structureItemID uuid.UUID,
) bool {
	locked, found, err := coursestructure.ItemBlueprintLockState(r.Context(), d.Pool, courseID, structureItemID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify structure item.")
		return false
	}
	if found && locked {
		cOrg, err := course.CourseOrgID(r.Context(), d.Pool, courseCode)
		if err != nil || cOrg == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course.")
			return false
		}
		if !d.userCanManageBlueprintLocks(r.Context(), viewer, *cOrg) {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "This item is managed by the district blueprint.")
			return false
		}
	}
	return true
}

// handlePatchCourseModule is PATCH /api/v1/courses/{course_code}/structure/modules/{module_id}.
func (d Deps) handlePatchCourseModule() http.HandlerFunc {
	type body struct {
		Title         string  `json:"title"`
		Published     bool    `json:"published"`
		VisibleFrom   *string `json:"visibleFrom"`
	}
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
		okPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit course structure.")
			return
		}
		moduleID, err := uuid.Parse(chi.URLParam(r, "module_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid module id.")
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
		if !d.guardCourseItemCreateBlueprint(w, r, courseCode, viewer, *cid, moduleID) {
			return
		}
		var b body
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		var vf *time.Time
		if b.VisibleFrom != nil {
			s := strings.TrimSpace(*b.VisibleFrom)
			if s != "" {
				tm, perr := parseRFC3339Timestamp(s)
				if perr != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "visibleFrom must be an ISO-8601 timestamp or null.")
					return
				}
				vf = &tm
			}
		}
		row, err := coursestructure.PatchCourseModule(r.Context(), d.Pool, *cid, moduleID, strings.TrimSpace(b.Title), b.Published, vf)
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
			return
		}
		if err != nil {
			if strings.Contains(err.Error(), "module title is required") {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title cannot be empty.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update module.")
			return
		}
		out, err := coursestructure.ItemResponseForRow(r.Context(), d.Pool, *cid, row)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load module.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// gradedChildJSON is the API view of a child item that has student grades.
type gradedChildJSON struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Kind  string `json:"kind"`
}

// resolveCourseModuleForMutation runs the auth + permission + blueprint checks
// shared by module-mutation endpoints. Returns the resolved course/module ids
// when the caller may proceed.
func (d Deps) resolveCourseModuleForMutation(
	w http.ResponseWriter, r *http.Request,
) (cid uuid.UUID, moduleID uuid.UUID, ok bool) {
	courseCode, viewer, ok := d.requireCourseAccess(w, r)
	if !ok {
		return uuid.UUID{}, uuid.UUID{}, false
	}
	hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	if !hasPerm {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit course structure.")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	moduleID, err = uuid.Parse(chi.URLParam(r, "module_id"))
	if err != nil {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid module id.")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	cidPtr, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	if cidPtr == nil {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	if !d.guardCourseItemCreateBlueprint(w, r, courseCode, viewer, *cidPtr, moduleID) {
		return uuid.UUID{}, uuid.UUID{}, false
	}
	return *cidPtr, moduleID, true
}

// handleCourseModuleDeletePreview is GET
// /api/v1/courses/{course_code}/structure/modules/{module_id}/delete-preview.
// Returns which child items have recorded grades so the UI can warn the user
// that those items will be archived (not deleted) before confirming.
func (d Deps) handleCourseModuleDeletePreview() http.HandlerFunc {
	type response struct {
		GradedItems []gradedChildJSON `json:"gradedItems"`
	}
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
		cid, moduleID, ok := d.resolveCourseModuleForMutation(w, r)
		if !ok {
			return
		}
		exists, err := coursestructure.ModuleExists(r.Context(), d.Pool, cid, moduleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load module.")
			return
		}
		if !exists {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
			return
		}
		graded, err := coursestructure.ListModuleChildrenWithGrades(r.Context(), d.Pool, cid, moduleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load module grades.")
			return
		}
		out := response{GradedItems: make([]gradedChildJSON, 0, len(graded))}
		for _, g := range graded {
			out.GradedItems = append(out.GradedItems, gradedChildJSON{
				ID:    g.ID.String(),
				Title: g.Title,
				Kind:  g.Kind,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleDeleteCourseModule is DELETE
// /api/v1/courses/{course_code}/structure/modules/{module_id}.
//
// When any child item has recorded grades the module + its children are
// archived (so grades are preserved) and the response is
// {"action":"archived","archivedItems":[...]}. Otherwise the module is deleted
// outright and dependent rows fall away via ON DELETE CASCADE; the response is
// {"action":"deleted"}.
func (d Deps) handleDeleteCourseModule() http.HandlerFunc {
	type response struct {
		Action         string            `json:"action"`
		ArchivedItems  []gradedChildJSON `json:"archivedItems,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		cid, moduleID, ok := d.resolveCourseModuleForMutation(w, r)
		if !ok {
			return
		}
		exists, err := coursestructure.ModuleExists(r.Context(), d.Pool, cid, moduleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load module.")
			return
		}
		if !exists {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
			return
		}
		graded, err := coursestructure.ListModuleChildrenWithGrades(r.Context(), d.Pool, cid, moduleID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load module grades.")
			return
		}
		out := response{}
		if len(graded) > 0 {
			if err := coursestructure.ArchiveCourseModuleAndChildren(r.Context(), d.Pool, cid, moduleID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to archive module.")
				return
			}
			out.Action = "archived"
			out.ArchivedItems = make([]gradedChildJSON, 0, len(graded))
			for _, g := range graded {
				out.ArchivedItems = append(out.ArchivedItems, gradedChildJSON{
					ID:    g.ID.String(),
					Title: g.Title,
					Kind:  g.Kind,
				})
			}
		} else {
			if err := coursestructure.DeleteCourseModule(r.Context(), d.Pool, cid, moduleID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
					return
				}
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete module.")
				return
			}
			out.Action = "deleted"
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleCourseLtiExternalTools is GET /api/v1/courses/{course_code}/lti-external-tools.
func (d Deps) handleCourseLtiExternalTools() http.HandlerFunc {
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
		okPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit course structure.")
			return
		}
		tools, err := ltidb.ListActiveExternalToolsForCourse(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load external tools.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(tools)
	}
}

type createModuleTitleBody struct {
	Title string `json:"title"`
}

func (d Deps) beginCreateUnderModule(
	w http.ResponseWriter,
	r *http.Request,
) (courseCode string, viewer uuid.UUID, cid uuid.UUID, moduleID uuid.UUID, ok bool) {
	courseCode, viewer, ok = d.requireCourseAccess(w, r)
	if !ok {
		return "", uuid.UUID{}, uuid.UUID{}, uuid.UUID{}, false
	}
	hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return "", uuid.UUID{}, uuid.UUID{}, uuid.UUID{}, false
	}
	if !hasPerm {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit course structure.")
		return "", uuid.UUID{}, uuid.UUID{}, uuid.UUID{}, false
	}
	parsedModule, err := uuid.Parse(chi.URLParam(r, "module_id"))
	if err != nil {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid module id.")
		return "", uuid.UUID{}, uuid.UUID{}, uuid.UUID{}, false
	}
	cidPtr, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
		return "", uuid.UUID{}, uuid.UUID{}, uuid.UUID{}, false
	}
	if cidPtr == nil {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
		return "", uuid.UUID{}, uuid.UUID{}, uuid.UUID{}, false
	}
	if !d.guardCourseItemCreateBlueprint(w, r, courseCode, viewer, *cidPtr, parsedModule) {
		return "", uuid.UUID{}, uuid.UUID{}, uuid.UUID{}, false
	}
	return courseCode, viewer, *cidPtr, parsedModule, true
}

func (d Deps) writeCreatedStructureItem(w http.ResponseWriter, r *http.Request, courseID uuid.UUID, row coursestructure.ItemRow) {
	out, err := coursestructure.ItemResponseForRow(r.Context(), d.Pool, courseID, row)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load structure item.")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(out)
}

// handleCreateModuleHeading is POST /api/v1/courses/{course_code}/structure/modules/{module_id}/headings.
func (d Deps) handleCreateModuleHeading() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		_, _, cid, moduleID, ok := d.beginCreateUnderModule(w, r)
		if !ok {
			return
		}
		var b createModuleTitleBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		row, err := coursestructure.InsertHeadingUnderModule(r.Context(), d.Pool, cid, moduleID, b.Title)
		if err != nil {
			if strings.Contains(err.Error(), "title is required") {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create heading.")
			return
		}
		d.writeCreatedStructureItem(w, r, cid, row)
	}
}

// handleCreateModuleContentPage is POST .../content-pages.
func (d Deps) handleCreateModuleContentPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		_, _, cid, moduleID, ok := d.beginCreateUnderModule(w, r)
		if !ok {
			return
		}
		var b createModuleTitleBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		row, err := coursestructure.InsertContentPageUnderModule(r.Context(), d.Pool, cid, moduleID, b.Title)
		if err != nil {
			if strings.Contains(err.Error(), "title is required") {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create content page.")
			return
		}
		d.writeCreatedStructureItem(w, r, cid, row)
	}
}

// handleCreateModuleAssignment is POST .../assignments.
func (d Deps) handleCreateModuleAssignment() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		_, _, cid, moduleID, ok := d.beginCreateUnderModule(w, r)
		if !ok {
			return
		}
		var b createModuleTitleBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		row, err := coursestructure.InsertAssignmentUnderModule(r.Context(), d.Pool, cid, moduleID, b.Title)
		if err != nil {
			if strings.Contains(err.Error(), "title is required") {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create assignment.")
			return
		}
		d.writeCreatedStructureItem(w, r, cid, row)
	}
}

// handleCreateModuleQuiz is POST .../quizzes.
func (d Deps) handleCreateModuleQuiz() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		_, _, cid, moduleID, ok := d.beginCreateUnderModule(w, r)
		if !ok {
			return
		}
		var b createModuleTitleBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		row, err := coursestructure.InsertQuizUnderModule(r.Context(), d.Pool, cid, moduleID, b.Title)
		if err != nil {
			if strings.Contains(err.Error(), "title is required") {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create quiz.")
			return
		}
		d.writeCreatedStructureItem(w, r, cid, row)
	}
}

type createExternalLinkBody struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

// handleCreateModuleExternalLink is POST .../external-links.
func (d Deps) handleCreateModuleExternalLink() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		_, _, cid, moduleID, ok := d.beginCreateUnderModule(w, r)
		if !ok {
			return
		}
		var b createExternalLinkBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		row, err := coursestructure.InsertExternalLinkUnderModule(r.Context(), d.Pool, cid, moduleID, b.Title, b.URL)
		if err != nil {
			if strings.Contains(err.Error(), "title is required") {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create external link.")
			return
		}
		d.writeCreatedStructureItem(w, r, cid, row)
	}
}

type createLTILinkBody struct {
	Title            string  `json:"title"`
	ExternalToolID   string  `json:"externalToolId"`
	ResourceLinkID   string  `json:"resourceLinkId"`
	LineItemURL      *string `json:"lineItemUrl"`
}

// handleCreateModuleLTILink is POST .../lti-links.
func (d Deps) handleCreateModuleLTILink() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		_, _, cid, moduleID, ok := d.beginCreateUnderModule(w, r)
		if !ok {
			return
		}
		var b createLTILinkBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		toolID, err := uuid.Parse(strings.TrimSpace(b.ExternalToolID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid externalToolId.")
			return
		}
		tool, err := ltidb.GetExternalToolByID(r.Context(), d.Pool, toolID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify external tool.")
			return
		}
		if tool == nil || !tool.Active {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Unknown or inactive external tool.")
			return
		}
		row, err := coursestructure.InsertLTILinkUnderModule(
			r.Context(), d.Pool, cid, moduleID, toolID, b.Title, b.ResourceLinkID, b.LineItemURL,
		)
		if err != nil {
			if strings.Contains(err.Error(), "title is required") {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Module not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create LTI link.")
			return
		}
		d.writeCreatedStructureItem(w, r, cid, row)
	}
}
