package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursefeed"
	"github.com/lextures/lextures/server/internal/repos/groupspaces"
)

// groupSpacesFeatureOff returns true (and writes a 404) if group spaces are disabled for the
// course.  Callers should return immediately when true is returned.
func (d Deps) groupSpacesFeatureOff(w http.ResponseWriter, r *http.Request, courseCode string) bool {
	crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
	if err != nil || crow == nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
		return true
	}
	if !crow.GroupSpacesEnabled {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Group spaces are not enabled for this course.")
		return true
	}
	return false
}

// requireGroupAccess validates:
//  1. The group_id URL param is a valid UUID.
//  2. The group belongs to this course.
//  3. The viewer is a member of the group OR an instructor.
//
// Returns (groupID, isInstructor, ok). When ok is false a response has already been written.
func (d Deps) requireGroupAccess(w http.ResponseWriter, r *http.Request, courseCode string, viewer uuid.UUID) (groupID uuid.UUID, isInstructor bool, ok bool) {
	gidStr := chi.URLParam(r, "group_id")
	gid, err := uuid.Parse(gidStr)
	if err != nil {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid group id.")
		return uuid.Nil, false, false
	}

	// Verify the group belongs to this course.
	grp, err := groupspaces.GetGroupByCourseAndID(r.Context(), d.Pool, courseCode, gid)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load group.")
		return uuid.Nil, false, false
	}
	if grp == nil {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Group not found.")
		return uuid.Nil, false, false
	}

	instructor, err := groupspaces.IsInstructor(r.Context(), d.Pool, courseCode, viewer)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify role.")
		return uuid.Nil, false, false
	}
	if instructor {
		return gid, true, true
	}

	member, err := groupspaces.IsGroupMember(r.Context(), d.Pool, courseCode, gid, viewer)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify group membership.")
		return uuid.Nil, false, false
	}
	if !member {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You are not a member of this group.")
		return uuid.Nil, false, false
	}
	return gid, false, true
}

// handleListGroups is GET /api/v1/courses/{course_code}/groups — instructor view of all groups.
func (d Deps) handleListGroups() http.HandlerFunc {
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
		if d.groupSpacesFeatureOff(w, r, courseCode) {
			return
		}
		isInstructor, err := groupspaces.IsInstructor(r.Context(), d.Pool, courseCode, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify role.")
			return
		}
		if !isInstructor {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Instructor access required.")
			return
		}
		groups, err := groupspaces.ListGroupsForCourse(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not list groups.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"groups": groups})
	}
}

// handleListMyGroups is GET /api/v1/courses/{course_code}/my-groups — student view of their groups.
func (d Deps) handleListMyGroups() http.HandlerFunc {
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
		if d.groupSpacesFeatureOff(w, r, courseCode) {
			return
		}
		groups, err := groupspaces.ListGroupsForUser(r.Context(), d.Pool, courseCode, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not list groups.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"groups": groups})
	}
}

// handleListGroupChannels is GET /api/v1/courses/{course_code}/groups/{group_id}/feed/channels.
func (d Deps) handleListGroupChannels() http.HandlerFunc {
	type ch struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		SortOrder int    `json:"sortOrder"`
		CreatedAt string `json:"createdAt"`
	}
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
		if d.groupSpacesFeatureOff(w, r, courseCode) {
			return
		}
		gid, _, ok2 := d.requireGroupAccess(w, r, courseCode, viewer)
		if !ok2 {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		channels, err := coursefeed.ListGroupChannels(r.Context(), d.Pool, *cid, gid, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not list channels.")
			return
		}
		out := make([]ch, 0, len(channels))
		for _, c := range channels {
			out = append(out, ch{
				ID:        c.ID.String(),
				Name:      c.Name,
				SortOrder: c.SortOrder,
				CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"channels": out})
	}
}

// handleCreateGroupChannel is POST /api/v1/courses/{course_code}/groups/{group_id}/feed/channels.
func (d Deps) handleCreateGroupChannel() http.HandlerFunc {
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
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		if d.groupSpacesFeatureOff(w, r, courseCode) {
			return
		}
		gid, isInstructor, ok2 := d.requireGroupAccess(w, r, courseCode, viewer)
		if !ok2 {
			return
		}
		if !isInstructor {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only instructors can create group channels.")
			return
		}
		var in req
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		name := strings.TrimSpace(in.Name)
		if name == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Channel name is required.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		ch, err := coursefeed.CreateGroupChannel(r.Context(), d.Pool, *cid, gid, viewer, name)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not create channel.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(resp{
			ID:        ch.ID.String(),
			Name:      ch.Name,
			SortOrder: ch.SortOrder,
			CreatedAt: ch.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
}

// handleListGroupMessages is GET /api/v1/courses/{course_code}/groups/{group_id}/feed/channels/{channel_id}/messages.
func (d Deps) handleListGroupMessages() http.HandlerFunc {
	type resp struct {
		Messages []coursefeed.MessagePublic `json:"messages"`
	}
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
		if d.groupSpacesFeatureOff(w, r, courseCode) {
			return
		}
		gid, _, ok2 := d.requireGroupAccess(w, r, courseCode, viewer)
		if !ok2 {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		channelID, err := uuid.Parse(chi.URLParam(r, "channel_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid channel id.")
			return
		}
		belongs, err := coursefeed.GroupChannelBelongsToGroup(r.Context(), d.Pool, *cid, channelID, gid)
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

// handlePostGroupMessage is POST /api/v1/courses/{course_code}/groups/{group_id}/feed/channels/{channel_id}/messages.
func (d Deps) handlePostGroupMessage() http.HandlerFunc {
	type req struct {
		Body             string   `json:"body"`
		ParentMessageID  *string  `json:"parentMessageId"`
		MentionUserIDs   []string `json:"mentionUserIds"`
		MentionsEveryone bool     `json:"mentionsEveryone"`
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
		if d.groupSpacesFeatureOff(w, r, courseCode) {
			return
		}
		gid, _, ok2 := d.requireGroupAccess(w, r, courseCode, viewer)
		if !ok2 {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		channelID, err := uuid.Parse(chi.URLParam(r, "channel_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid channel id.")
			return
		}
		belongs, err := coursefeed.GroupChannelBelongsToGroup(r.Context(), d.Pool, *cid, channelID, gid)
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
			pid, err := uuid.Parse(strings.TrimSpace(*in.ParentMessageID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid parent message id.")
				return
			}
			isRoot, err := coursefeed.ParentIsRootInChannel(r.Context(), d.Pool, channelID, pid)
			if err != nil || !isRoot {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Parent message not found in this channel.")
				return
			}
			parentID = &pid
		}
		mentionIDs := make([]uuid.UUID, 0, len(in.MentionUserIDs))
		for _, s := range in.MentionUserIDs {
			id, err := uuid.Parse(s)
			if err == nil {
				mentionIDs = append(mentionIDs, id)
			}
		}
		msgID, err := coursefeed.CreateMessage(r.Context(), d.Pool, channelID, viewer, body, parentID, mentionIDs, in.MentionsEveryone)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not post message.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": msgID.String()})
	}
}
