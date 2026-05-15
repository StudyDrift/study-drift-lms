package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/courseroles"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursefeed"
	"github.com/lextures/lextures/server/internal/repos/coursesections"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/recommendations"
	"github.com/lextures/lextures/server/internal/repos/srs"
)

// Stubs and thin reads for LMS dashboard until full ports.

func (d Deps) handleLearnerReviewStats() http.HandlerFunc {
	type resp struct {
		Streak            int     `json:"streak"`
		DueToday          int64   `json:"dueToday"`
		DueWeek           int64   `json:"dueWeek"`
		RetentionEstimate float64 `json:"retentionEstimate"`
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
		can, err := assertCanReadLearnerState(r.Context(), d.Pool, viewer, learner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !can {
			writeLearnerAccessDenied(w)
			return
		}
		streak, dueToday, dueWeek, retention, err := srs.ReviewStats(r.Context(), d.Pool, learner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load review stats.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{
			Streak:            streak,
			DueToday:          dueToday,
			DueWeek:           dueWeek,
			RetentionEstimate: retention,
		})
	}
}

func (d Deps) handleLearnerReviewQueue() http.HandlerFunc {
	type item struct {
		StateID       string           `json:"stateId"`
		QuestionID    string           `json:"questionId"`
		CourseID      string           `json:"courseId"`
		CourseCode    string           `json:"courseCode"`
		CourseTitle   string           `json:"courseTitle"`
		NextReviewAt  string           `json:"nextReviewAt"`
		Stem          string           `json:"stem"`
		QuestionType  string           `json:"questionType"`
		Options       *json.RawMessage `json:"options,omitempty"`
		CorrectAnswer *json.RawMessage `json:"correctAnswer,omitempty"`
		Explanation   *string          `json:"explanation,omitempty"`
	}
	type resp struct {
		Items    []item `json:"items"`
		TotalDue int64  `json:"totalDue"`
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
		can, err := assertCanReadLearnerState(r.Context(), d.Pool, viewer, learner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !can {
			writeLearnerAccessDenied(w)
			return
		}
		limit := int64(50)
		if v := r.URL.Query().Get("limit"); v != "" {
			if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
				limit = parsed
			}
		}
		if limit < 1 {
			limit = 1
		}
		if limit > 200 {
			limit = 200
		}
		offset := int64(0)
		if v := r.URL.Query().Get("offset"); v != "" {
			if parsed, err := strconv.ParseInt(v, 10, 64); err == nil && parsed > 0 {
				offset = parsed
			}
		}
		total, err := srs.CountDueForUser(r.Context(), d.Pool, learner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load review queue.")
			return
		}
		rows, err := srs.ListReviewQueue(r.Context(), d.Pool, learner, limit, offset)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load review queue.")
			return
		}
		items := make([]item, 0, len(rows))
		for _, row := range rows {
			it := item{
				StateID:      row.StateID.String(),
				QuestionID:   row.QuestionID.String(),
				CourseID:     row.CourseID.String(),
				CourseCode:   row.CourseCode,
				CourseTitle:  row.CourseTitle,
				NextReviewAt: row.NextReviewAt.UTC().Format(time.RFC3339),
				Stem:         row.Stem,
				QuestionType: row.QuestionType,
				Explanation:  row.Explanation,
			}
			if len(row.Options) > 0 {
				raw := json.RawMessage(append([]byte(nil), row.Options...))
				it.Options = &raw
			}
			if len(row.CorrectAnswer) > 0 {
				raw := json.RawMessage(append([]byte(nil), row.CorrectAnswer...))
				it.CorrectAnswer = &raw
			}
			items = append(items, it)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Items: items, TotalDue: total})
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
		Degraded        bool   `json:"degraded,omitempty"`
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
		can, err := assertCanReadLearnerState(r.Context(), d.Pool, viewer, learner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !can {
			writeLearnerAccessDenied(w)
			return
		}
		courseIDStr := strings.TrimSpace(r.URL.Query().Get("courseId"))
		if courseIDStr == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "courseId is required.")
			return
		}
		courseID, err := uuid.Parse(courseIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid courseId.")
			return
		}
		surface := strings.TrimSpace(r.URL.Query().Get("surface"))
		if surface == "" {
			surface = "continue"
		}
		if surface != "continue" && surface != "strengthen" && surface != "challenge" && surface != "review" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "surface must be continue, strengthen, challenge, or review.")
			return
		}
		okAccess, err := enrollment.UserHasAccessByCourseID(r.Context(), d.Pool, courseID, learner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !okAccess {
			writeLearnerAccessDenied(w)
			return
		}
		limit := 10
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				limit = n
			}
		}
		if limit < 1 {
			limit = 1
		}
		if limit > 10 {
			limit = 10
		}
		cached, expired, err := recommendations.GetCache(r.Context(), d.Pool, learner, courseID, surface)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load recommendations.")
			return
		}
		out := resp{Recommendations: []item{}, Degraded: false}
		if cached != nil && !expired {
			for _, raw := range cached.Recommendations {
				var it item
				if err := json.Unmarshal(raw, &it); err != nil {
					continue
				}
				out.Recommendations = append(out.Recommendations, it)
			}
			if cached.Degraded {
				out.Degraded = true
			}
		} else {
			out.Degraded = true
		}
		if len(out.Recommendations) > limit {
			out.Recommendations = out.Recommendations[:limit]
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
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
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err == nil && crow != nil && crow.SectionsEnabled && !staffView {
			secID, err := enrollment.GetStudentSectionID(r.Context(), d.Pool, *cid, viewer)
			if err == nil && secID != nil {
				ovm, err := coursesections.ListOverridesForSection(r.Context(), d.Pool, *secID)
				if err == nil && len(ovm) > 0 {
					applySectionAssignmentOverrides(items, ovm)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Items: items})
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
		canEdit, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
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
		ID           string  `json:"id"`
		UserID       string  `json:"userId"`
		DisplayName  *string `json:"displayName"`
		Role         string  `json:"role"`
		RoleDisplay  *string `json:"roleDisplay,omitempty"`
		SectionID    *string `json:"sectionId,omitempty"`
		SectionCode  *string `json:"sectionCode,omitempty"`
		SectionName  *string `json:"sectionName,omitempty"`
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
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		canList, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":enrollments:read")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canList {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to view the roster.")
			return
		}
		roster, err := enrollment.ListRosterForCourse(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollments.")
			return
		}
		out := make([]row, 0, len(roster))
		for _, e := range roster {
			r := row{
				ID:          e.ID.String(),
				UserID:      e.UserID.String(),
				DisplayName: e.DisplayName,
				Role:        e.Role,
				RoleDisplay: e.RoleDisplay,
			}
			if e.SectionID != nil {
				s := e.SectionID.String()
				r.SectionID = &s
			}
			if e.SectionCode != nil {
				r.SectionCode = e.SectionCode
			}
			if e.SectionName != nil {
				r.SectionName = e.SectionName
			}
			out = append(out, r)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Enrollments: out})
	}
}
