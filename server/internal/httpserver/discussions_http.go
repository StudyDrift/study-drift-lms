package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/courseroles"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/discussions"
)

func (d Deps) discussionsFeatureOff(w http.ResponseWriter, r *http.Request, courseCode string) bool {
	crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
	if err != nil || crow == nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
		return true
	}
	if !crow.DiscussionsEnabled {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Discussions are not enabled for this course.")
		return true
	}
	return false
}

func (d Deps) handleDiscussionForumsList() http.HandlerFunc {
	type forum struct {
		ID          string  `json:"id"`
		Name        string  `json:"name"`
		Description *string `json:"description,omitempty"`
		Position    int     `json:"position"`
		CreatedAt   string  `json:"createdAt"`
	}
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		rows, err := discussions.ListForums(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not list forums.")
			return
		}
		out := make([]forum, 0, len(rows))
		for _, x := range rows {
			out = append(out, forum{
				ID:          x.ID.String(),
				Name:        x.Name,
				Description: x.Description,
				Position:    x.Position,
				CreatedAt:   x.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"forums": out})
	}
}

func (d Deps) handleDiscussionForumsPost() http.HandlerFunc {
	type req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Position    *int   `json:"position"`
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		can, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil || !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		pos := 0
		if in.Position != nil {
			pos = *in.Position
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		row, err := discussions.CreateForum(r.Context(), d.Pool, *cid, in.Name, in.Description, pos)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":          row.ID.String(),
			"name":        row.Name,
			"description": row.Description,
			"position":    row.Position,
			"createdAt":   row.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
}

func (d Deps) handleDiscussionThreadsList() http.HandlerFunc {
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		fid, err := uuid.Parse(chi.URLParam(r, "forum_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid forum id.")
			return
		}
		ok2, err := discussions.ForumBelongsToCourse(r.Context(), d.Pool, *cid, fid)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		rows, err := discussions.ListThreads(r.Context(), d.Pool, fid, 100)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not list threads.")
			return
		}
		type t struct {
			ID                        string  `json:"id"`
			ForumID                   string  `json:"forumId"`
			AuthorID                  string  `json:"authorId"`
			Title                     string  `json:"title"`
			IsPinned                  bool    `json:"isPinned"`
			IsLocked                  bool    `json:"isLocked"`
			RequirePostFirst          bool    `json:"requirePostFirst"`
			AssignmentStructureItemID *string `json:"assignmentStructureItemId,omitempty"`
			CreatedAt                 string  `json:"createdAt"`
			UpdatedAt                 string  `json:"updatedAt"`
			ReplyCount                int     `json:"replyCount"`
		}
		out := make([]t, 0, len(rows))
		for _, x := range rows {
			var aid *string
			if x.AssignmentStructureItemID != nil {
				s := x.AssignmentStructureItemID.String()
				aid = &s
			}
			out = append(out, t{
				ID:                        x.ID.String(),
				ForumID:                   x.ForumID.String(),
				AuthorID:                  x.AuthorID.String(),
				Title:                     x.Title,
				IsPinned:                  x.IsPinned,
				IsLocked:                  x.IsLocked,
				RequirePostFirst:          x.RequirePostFirst,
				AssignmentStructureItemID: aid,
				CreatedAt:                 x.CreatedAt.UTC().Format(time.RFC3339),
				UpdatedAt:                 x.UpdatedAt.UTC().Format(time.RFC3339),
				ReplyCount:                x.ReplyCount,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"threads": out})
	}
}

func (d Deps) handleDiscussionThreadsPost() http.HandlerFunc {
	type req struct {
		Title                     string          `json:"title"`
		Body                      json.RawMessage `json:"body"`
		AssignmentStructureItemID *string         `json:"assignmentStructureItemId"`
		RequirePostFirst          bool            `json:"requirePostFirst"`
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		fid, err := uuid.Parse(chi.URLParam(r, "forum_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid forum id.")
			return
		}
		ok2, err := discussions.ForumBelongsToCourse(r.Context(), d.Pool, *cid, fid)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		var assign *uuid.UUID
		if in.AssignmentStructureItemID != nil && strings.TrimSpace(*in.AssignmentStructureItemID) != "" {
			id, err := uuid.Parse(strings.TrimSpace(*in.AssignmentStructureItemID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid assignment id.")
				return
			}
			ok3, err := discussions.AssignmentBelongsToCourse(r.Context(), d.Pool, *cid, id)
			if err != nil || !ok3 {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Assignment not in this course.")
				return
			}
			assign = &id
		}
		row, err := discussions.CreateThread(r.Context(), d.Pool, fid, viewer, in.Title, in.Body, assign, in.RequirePostFirst)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(threadDetailJSON(row))
	}
}

func threadDetailJSON(row *discussions.ThreadDetail) map[string]any {
	var aid *string
	if row.AssignmentStructureItemID != nil {
		s := row.AssignmentStructureItemID.String()
		aid = &s
	}
	return map[string]any{
		"id":                        row.ID.String(),
		"forumId":                   row.ForumID.String(),
		"authorId":                  row.AuthorID.String(),
		"title":                     row.Title,
		"body":                      json.RawMessage(row.Body),
		"isPinned":                  row.IsPinned,
		"isLocked":                  row.IsLocked,
		"requirePostFirst":          row.RequirePostFirst,
		"assignmentStructureItemId": aid,
		"createdAt":                 row.CreatedAt.UTC().Format(time.RFC3339),
		"updatedAt":                 row.UpdatedAt.UTC().Format(time.RFC3339),
		"replyCount":                row.ReplyCount,
	}
}

func (d Deps) handleDiscussionThreadGet() http.HandlerFunc {
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		tid, err := uuid.Parse(chi.URLParam(r, "thread_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid thread id.")
			return
		}
		row, err := discussions.GetThread(r.Context(), d.Pool, *cid, tid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load thread.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(threadDetailJSON(row))
	}
}

func (d Deps) handleDiscussionThreadPatch() http.HandlerFunc {
	type req struct {
		IsPinned *bool   `json:"isPinned"`
		IsLocked *bool   `json:"isLocked"`
		Title    *string `json:"title"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		if d.discussionsFeatureOff(w, r, courseCode) {
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
		tid, err := uuid.Parse(chi.URLParam(r, "thread_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid thread id.")
			return
		}
		ok2, err := discussions.ThreadBelongsToCourse(r.Context(), d.Pool, *cid, tid)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		row, err := discussions.PatchThread(r.Context(), d.Pool, tid, in.IsPinned, in.IsLocked, in.Title)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(threadDetailJSON(row))
	}
}

func (d Deps) handleDiscussionPostsList() http.HandlerFunc {
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		tid, err := uuid.Parse(chi.URLParam(r, "thread_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid thread id.")
			return
		}
		ok2, err := discussions.ThreadBelongsToCourse(r.Context(), d.Pool, *cid, tid)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		staff, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		th, err := discussions.GetThread(r.Context(), d.Pool, *cid, tid)
		if err != nil || th == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		hidePeers := false
		if th.RequirePostFirst && !staff {
			has, err := discussions.StudentHasRootPost(r.Context(), d.Pool, tid, viewer)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load posts.")
				return
			}
			hidePeers = !has
		}
		var afterT *time.Time
		var afterID *uuid.UUID
		if ts := strings.TrimSpace(r.URL.Query().Get("afterCreatedAt")); ts != "" {
			tv, err := time.Parse(time.RFC3339Nano, ts)
			if err != nil {
				tv, err = time.Parse(time.RFC3339, ts)
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid afterCreatedAt.")
					return
				}
			}
			afterT = &tv
		}
		if s := strings.TrimSpace(r.URL.Query().Get("afterId")); s != "" {
			id, err := uuid.Parse(s)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid afterId.")
				return
			}
			afterID = &id
		}
		if (afterT == nil) != (afterID == nil) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "afterCreatedAt and afterId must be used together.")
			return
		}
		rows, err := discussions.ListPosts(r.Context(), d.Pool, tid, viewer, staff, hidePeers, afterT, afterID, 200)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load posts.")
			return
		}
		type p struct {
			ID            string          `json:"id"`
			ThreadID      string          `json:"threadId"`
			ParentPostID  *string         `json:"parentPostId,omitempty"`
			AuthorID      string          `json:"authorId"`
			Body          json.RawMessage `json:"body"`
			UpvoteCount   int             `json:"upvoteCount"`
			ViewerUpvoted bool            `json:"viewerUpvoted"`
			CreatedAt     string          `json:"createdAt"`
			UpdatedAt     string          `json:"updatedAt"`
		}
		out := make([]p, 0, len(rows))
		for _, x := range rows {
			var pp *string
			if x.ParentPostID != nil {
				s := x.ParentPostID.String()
				pp = &s
			}
			out = append(out, p{
				ID:            x.ID.String(),
				ThreadID:      x.ThreadID.String(),
				ParentPostID:  pp,
				AuthorID:      x.AuthorID.String(),
				Body:          json.RawMessage(x.Body),
				UpvoteCount:   x.UpvoteCount,
				ViewerUpvoted: x.ViewerUpvoted,
				CreatedAt:     x.CreatedAt.UTC().Format(time.RFC3339),
				UpdatedAt:     x.UpdatedAt.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"posts":                out,
			"hiddenUntilFirstPost": hidePeers,
		})
	}
}

func (d Deps) handleDiscussionPostsPost() http.HandlerFunc {
	type req struct {
		ParentPostID   *string         `json:"parentPostId"`
		Body           json.RawMessage `json:"body"`
		IdempotencyKey string          `json:"idempotencyKey"`
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		tid, err := uuid.Parse(chi.URLParam(r, "thread_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid thread id.")
			return
		}
		ok2, err := discussions.ThreadBelongsToCourse(r.Context(), d.Pool, *cid, tid)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		th, err := discussions.GetThread(r.Context(), d.Pool, *cid, tid)
		if err != nil || th == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if th.IsLocked {
			apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, "This discussion has been closed by the instructor.")
			return
		}
		staff, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if th.RequirePostFirst && !staff {
			has, err := discussions.StudentHasRootPost(r.Context(), d.Pool, tid, viewer)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not verify posting rules.")
				return
			}
			if !has && in.ParentPostID != nil && strings.TrimSpace(*in.ParentPostID) != "" {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Post a top-level reply first to view and join this discussion.")
				return
			}
		}
		var parent *uuid.UUID
		if in.ParentPostID != nil && strings.TrimSpace(*in.ParentPostID) != "" {
			id, err := uuid.Parse(strings.TrimSpace(*in.ParentPostID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid parent post id.")
				return
			}
			ok3, err := discussions.ParentPostThread(r.Context(), d.Pool, tid, id)
			if err != nil || !ok3 {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Parent post is not in this thread.")
				return
			}
			depth, err := discussions.ParentPostDepth(r.Context(), d.Pool, id)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
				return
			}
			if depth >= 2 {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Maximum reply depth reached.")
				return
			}
			parent = &id
		}
		if strings.TrimSpace(in.IdempotencyKey) != "" {
			existing, err := discussions.FindIdempotentPost(r.Context(), d.Pool, *cid, viewer, tid, in.IdempotencyKey)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not create post.")
				return
			}
			if existing != nil {
				row, err := discussions.GetPost(r.Context(), d.Pool, *cid, *existing, &viewer)
				if err != nil || row == nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load post.")
					return
				}
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				_ = json.NewEncoder(w).Encode(postJSON(row))
				return
			}
		}
		tx, err := d.Pool.Begin(r.Context())
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not create post.")
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()
		row, err := discussions.CreatePost(r.Context(), tx, *cid, tid, viewer, parent, in.Body, in.IdempotencyKey)
		if err != nil {
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
				_ = tx.Rollback(r.Context())
				if strings.TrimSpace(in.IdempotencyKey) != "" {
					existing, e2 := discussions.FindIdempotentPost(r.Context(), d.Pool, *cid, viewer, tid, in.IdempotencyKey)
					if e2 == nil && existing != nil {
						row2, e3 := discussions.GetPost(r.Context(), d.Pool, *cid, *existing, &viewer)
						if e3 == nil && row2 != nil {
							w.Header().Set("Content-Type", "application/json; charset=utf-8")
							_ = json.NewEncoder(w).Encode(postJSON(row2))
							return
						}
					}
				}
			}
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		if !staff && parent == nil {
			assign, err := discussions.ThreadAssignment(r.Context(), d.Pool, tid)
			if err == nil && assign != nil {
				_ = discussions.EnsureGradeForDiscussion(r.Context(), tx, *cid, viewer, *assign)
			}
		}
		if err := tx.Commit(r.Context()); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not create post.")
			return
		}
		row2, err := discussions.GetPost(r.Context(), d.Pool, *cid, row.ID, &viewer)
		if err != nil || row2 == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load post.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(postJSON(row2))
	}
}

func postJSON(x *discussions.PostRow) map[string]any {
	var pp *string
	if x.ParentPostID != nil {
		s := x.ParentPostID.String()
		pp = &s
	}
	return map[string]any{
		"id":            x.ID.String(),
		"threadId":      x.ThreadID.String(),
		"parentPostId":  pp,
		"authorId":      x.AuthorID.String(),
		"body":          json.RawMessage(x.Body),
		"upvoteCount":   x.UpvoteCount,
		"viewerUpvoted": x.ViewerUpvoted,
		"createdAt":     x.CreatedAt.UTC().Format(time.RFC3339),
		"updatedAt":     x.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (d Deps) handleDiscussionPostDelete() http.HandlerFunc {
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		pid, err := uuid.Parse(chi.URLParam(r, "post_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid post id.")
			return
		}
		ok2, err := discussions.PostBelongsToCourse(r.Context(), d.Pool, *cid, pid)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		row, err := discussions.GetPost(r.Context(), d.Pool, *cid, pid, nil)
		if err != nil || row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		canStaff, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if row.AuthorID != viewer && !canStaff {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		if err := discussions.DeletePost(r.Context(), d.Pool, pid); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not delete post.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleDiscussionPostUpvote() http.HandlerFunc {
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
		if d.discussionsFeatureOff(w, r, courseCode) {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		pid, err := uuid.Parse(chi.URLParam(r, "post_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid post id.")
			return
		}
		ok2, err := discussions.PostBelongsToCourse(r.Context(), d.Pool, *cid, pid)
		if err != nil || !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		added, cnt, err := discussions.Upvote(r.Context(), d.Pool, pid, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not upvote.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"wasAdded":    added,
			"upvoteCount": cnt,
		})
	}
}
