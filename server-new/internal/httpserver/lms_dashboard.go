package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/course"
	"github.com/lextures/lextures/server-new/internal/repos/coursefeed"
	"github.com/lextures/lextures/server-new/internal/repos/coursestructure"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
)

// Stubs and thin reads for LMS dashboard until full ports (see migration.md).

func (d Deps) handleLearnerReviewStats() http.HandlerFunc {
	type resp struct {
		Streak            int `json:"streak"`
		DueToday          int `json:"dueToday"`
		DueWeek           int `json:"dueWeek"`
		RetentionEstimate int `json:"retentionEstimate"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		learner, err := uuid.Parse(chi.URLParam(r, "user_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid learner id.")
			return
		}
		if learner != viewer {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{})
	}
}

func (d Deps) handleLearnerRecommendations() http.HandlerFunc {
	type item struct {
		ItemID   string  `json:"itemId"`
		ItemType string  `json:"itemType"`
		Title    string  `json:"title"`
		Surface  string  `json:"surface"`
		Reason   string  `json:"reason"`
		Score    float64 `json:"score"`
	}
	type resp struct {
		Recommendations []item `json:"recommendations"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		learner, err := uuid.Parse(chi.URLParam(r, "user_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid learner id.")
			return
		}
		if learner != viewer {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		// Query params courseId, surface, limit are reserved for a full engine.
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Recommendations: []item{}})
	}
}

func (d Deps) requireCourseAccess(w http.ResponseWriter, r *http.Request) (string, uuid.UUID, bool) {
	viewer, ok := d.meUserID(w, r)
	if !ok {
		return "", uuid.UUID{}, false
	}
	courseCode := chi.URLParam(r, "course_code")
	if courseCode == "" {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
		return "", uuid.UUID{}, false
	}
	has, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, viewer)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
		return "", uuid.UUID{}, false
	}
	if !has {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
		return "", uuid.UUID{}, false
	}
	return courseCode, viewer, true
}

func (d Deps) handleCourseStructure() http.HandlerFunc {
	type resp struct {
		Items []coursestructure.ItemResponse `json:"items"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
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
		staffView, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		items, err := coursestructure.ListForCourseWithEnrichment(r.Context(), d.Pool, *cid, staffView)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course structure.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Items: items})
	}
}

func (d Deps) handleCourseMyGrades() http.HandlerFunc {
	type resp struct {
		Columns          []any             `json:"columns"`
		Grades           map[string]string `json:"grades"`
		DisplayGrades    map[string]string `json:"displayGrades"`
		AssignmentGroups any               `json:"assignmentGroups,omitempty"`
		HeldGradeItemIds []string          `json:"heldGradeItemIds,omitempty"`
		DroppedGrades    map[string]bool   `json:"droppedGrades,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, _, ok := d.requireCourseAccess(w, r); !ok {
			return
		}
		emptyGrades := map[string]string{}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{
			Columns:          []any{},
			Grades:           emptyGrades,
			DisplayGrades:    emptyGrades,
			AssignmentGroups: []any{},
			HeldGradeItemIds: []string{},
			DroppedGrades:    map[string]bool{},
		})
	}
}

func (d Deps) handleFeedChannels() http.HandlerFunc {
	type ch struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		SortOrder int    `json:"sortOrder"`
		CreatedAt string `json:"createdAt"`
	}
	type resp struct {
		Channels []ch `json:"channels"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
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
		rows, err := coursefeed.ListChannels(r.Context(), d.Pool, *cid, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load feed channels.")
			return
		}
		channels := make([]ch, 0, len(rows))
		for _, row := range rows {
			channels = append(channels, ch{
				ID:        row.ID.String(),
				Name:      row.Name,
				SortOrder: row.SortOrder,
				CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Channels: channels})
	}
}

func (d Deps) handleCreateFeedChannel() http.HandlerFunc {
	type req struct {
		Name string `json:"name"`
	}
	type resp struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		SortOrder int    `json:"sortOrder"`
		CreatedAt string `json:"createdAt"`
	}
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
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		canEdit, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canEdit {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Channel name is required.")
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
		ch, err := coursefeed.CreateChannel(r.Context(), d.Pool, *cid, viewer, name)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create feed channel.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{
			ID:        ch.ID.String(),
			Name:      ch.Name,
			SortOrder: ch.SortOrder,
			CreatedAt: ch.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
}

// handleFeedRoster is GET /api/v1/courses/{course_code}/feed/roster — people for @mentions.
func (d Deps) handleFeedRoster() http.HandlerFunc {
	type person struct {
		UserID      string  `json:"userId"`
		Email       string  `json:"email"`
		DisplayName *string `json:"displayName"`
	}
	type resp struct {
		People []person `json:"people"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, _, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		rows, err := enrollment.ListFeedRosterForCourse(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load feed roster.")
			return
		}
		people := make([]person, 0, len(rows))
		for _, p := range rows {
			people = append(people, person{
				UserID:      p.UserID.String(),
				Email:       p.Email,
				DisplayName: p.DisplayName,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{People: people})
	}
}

func (d Deps) handleFeedMessagesList() http.HandlerFunc {
	type resp struct {
		Messages []coursefeed.MessagePublic `json:"messages"`
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
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
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
		channelID, err := uuid.Parse(chi.URLParam(r, "channel_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid channel id.")
			return
		}
		belongs, err := coursefeed.ChannelBelongsToCourse(r.Context(), d.Pool, *cid, channelID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load channel.")
			return
		}
		if !belongs {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		msgs, err := coursefeed.ListMessagesThreaded(r.Context(), d.Pool, channelID, viewer, 200)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load messages.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Messages: msgs})
	}
}

func (d Deps) handleFeedMessagePost() http.HandlerFunc {
	type req struct {
		Body             string   `json:"body"`
		ParentMessageID  *string  `json:"parentMessageId"`
		MentionUserIDs   []string `json:"mentionUserIds"`
		MentionsEveryone bool     `json:"mentionsEveryone"`
	}
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
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
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
		channelID, err := uuid.Parse(chi.URLParam(r, "channel_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid channel id.")
			return
		}
		belongs, err := coursefeed.ChannelBelongsToCourse(r.Context(), d.Pool, *cid, channelID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load channel.")
			return
		}
		if !belongs {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		body := strings.TrimSpace(in.Body)
		if body == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Message body is required.")
			return
		}
		var parentID *uuid.UUID
		if in.ParentMessageID != nil && strings.TrimSpace(*in.ParentMessageID) != "" {
			p, err := uuid.Parse(strings.TrimSpace(*in.ParentMessageID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid parentMessageId.")
				return
			}
			ok, err := coursefeed.ParentIsRootInChannel(r.Context(), d.Pool, channelID, p)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to validate parent message.")
				return
			}
			if !ok {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Reply parent must be a root message in this channel.")
				return
			}
			parentID = &p
		}
		mentions := make([]uuid.UUID, 0, len(in.MentionUserIDs))
		for _, m := range in.MentionUserIDs {
			u, err := uuid.Parse(strings.TrimSpace(m))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid mentionUserIds.")
				return
			}
			mentions = append(mentions, u)
		}
		id, err := coursefeed.CreateMessage(r.Context(), d.Pool, channelID, viewer, body, parentID, mentions, in.MentionsEveryone)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create message.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id.String()})
	}
}

func (d Deps) handleCourseEnrollmentsList() http.HandlerFunc {
	type row struct {
		ID          string  `json:"id"`
		UserID      string  `json:"userId"`
		DisplayName *string `json:"displayName"`
		Role        string  `json:"role"`
	}
	type resp struct {
		Enrollments []row `json:"enrollments"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, _, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		roster, err := enrollment.ListRosterForCourse(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollments.")
			return
		}
		out := make([]row, 0, len(roster))
		for _, e := range roster {
			out = append(out, row{
				ID:          e.ID.String(),
				UserID:      e.UserID.String(),
				DisplayName: e.DisplayName,
				Role:        e.Role,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Enrollments: out})
	}
}
