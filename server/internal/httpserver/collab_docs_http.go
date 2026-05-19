package httpserver

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/courseroles"
	"github.com/lextures/lextures/server/internal/repos/collabdocs"
	"github.com/lextures/lextures/server/internal/repos/course"
)

func (d Deps) collabDocsFeatureOff(w http.ResponseWriter, r *http.Request, courseCode string) bool {
	crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
	if err != nil || crow == nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
		return true
	}
	if !crow.CollabDocsEnabled {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Collaborative documents are not enabled for this course.")
		return true
	}
	return false
}

func docJSON(d collabdocs.Doc) map[string]any {
	var gid *string
	if d.GroupID != nil {
		s := d.GroupID.String()
		gid = &s
	}
	return map[string]any{
		"id":        d.ID.String(),
		"courseId":  d.CourseID.String(),
		"groupId":   gid,
		"title":     d.Title,
		"docType":   d.DocType,
		"createdBy": d.CreatedBy.String(),
		"createdAt": d.CreatedAt.UTC().Format(time.RFC3339),
		"updatedAt": d.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// handleListCollabDocs is GET /api/v1/courses/{course_code}/collab-docs.
func (d Deps) handleListCollabDocs() http.HandlerFunc {
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
		if d.collabDocsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		docs, err := collabdocs.List(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not list documents.")
			return
		}
		out := make([]map[string]any, 0, len(docs))
		for _, doc := range docs {
			out = append(out, docJSON(doc))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"docs": out})
	}
}

// handleCreateCollabDoc is POST /api/v1/courses/{course_code}/collab-docs.
func (d Deps) handleCreateCollabDoc() http.HandlerFunc {
	type req struct {
		Title   string `json:"title"`
		DocType string `json:"docType"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		if d.collabDocsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if in.Title == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
			return
		}
		docType := in.DocType
		if docType == "" {
			docType = "rich_text"
		}
		if docType != "rich_text" && docType != "whiteboard" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "docType must be 'rich_text' or 'whiteboard'.")
			return
		}
		doc, err := collabdocs.Create(r.Context(), d.Pool, *cid, viewer, in.Title, docType)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not create document.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(docJSON(*doc))
	}
}

// handleGetCollabDoc is GET /api/v1/courses/{course_code}/collab-docs/{doc_id}.
func (d Deps) handleGetCollabDoc() http.HandlerFunc {
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
		if d.collabDocsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		docID, err := uuid.Parse(chi.URLParam(r, "doc_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid document id.")
			return
		}
		ok2, err := collabdocs.BelongsToCourse(r.Context(), d.Pool, *cid, docID)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		doc, err := collabdocs.Get(r.Context(), d.Pool, docID)
		if err != nil || doc == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(docJSON(*doc))
	}
}

// handlePatchCollabDoc is PATCH /api/v1/courses/{course_code}/collab-docs/{doc_id}.
func (d Deps) handlePatchCollabDoc() http.HandlerFunc {
	type req struct {
		Title *string `json:"title"`
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
		if d.collabDocsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		docID, err := uuid.Parse(chi.URLParam(r, "doc_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid document id.")
			return
		}
		ok2, err := collabdocs.BelongsToCourse(r.Context(), d.Pool, *cid, docID)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if in.Title == nil || *in.Title == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title is required.")
			return
		}
		doc, err := collabdocs.PatchTitle(r.Context(), d.Pool, docID, *in.Title)
		if err != nil || doc == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not update document.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(docJSON(*doc))
	}
}

// handleDeleteCollabDoc is DELETE /api/v1/courses/{course_code}/collab-docs/{doc_id}.
func (d Deps) handleDeleteCollabDoc() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		if d.collabDocsFeatureOff(w, r, courseCode) {
			return
		}
		can, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil || !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		docID, err := uuid.Parse(chi.URLParam(r, "doc_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid document id.")
			return
		}
		ok2, err := collabdocs.BelongsToCourse(r.Context(), d.Pool, *cid, docID)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if err := collabdocs.Delete(r.Context(), d.Pool, docID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not delete document.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleGetCollabDocSnapshots is GET /api/v1/courses/{course_code}/collab-docs/{doc_id}/snapshots.
func (d Deps) handleGetCollabDocSnapshots() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		if d.collabDocsFeatureOff(w, r, courseCode) {
			return
		}
		can, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil || !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		docID, err := uuid.Parse(chi.URLParam(r, "doc_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid document id.")
			return
		}
		ok2, err := collabdocs.BelongsToCourse(r.Context(), d.Pool, *cid, docID)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		snapshots, err := collabdocs.ListSnapshots(r.Context(), d.Pool, docID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not list snapshots.")
			return
		}
		out := make([]map[string]any, 0, len(snapshots))
		for _, s := range snapshots {
			out = append(out, map[string]any{
				"id":       s.ID.String(),
				"docId":    s.DocID.String(),
				"authorId": s.AuthorID.String(),
				"takenAt":  s.TakenAt.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"snapshots": out})
	}
}
