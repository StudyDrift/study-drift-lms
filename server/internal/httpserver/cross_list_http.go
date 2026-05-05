package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/crosslisting"
)

type crossListMemberJSON struct {
	SectionID   string  `json:"sectionId"`
	IsPrimary   bool    `json:"isPrimary"`
	SectionCode string  `json:"sectionCode"`
	SectionName *string `json:"sectionName,omitempty"`
}

type crossListGroupJSON struct {
	ID               string                `json:"id"`
	CourseID         string                `json:"courseId"`
	Name             *string               `json:"name,omitempty"`
	CreatedAt        string                `json:"createdAt"`
	PrimarySectionID *string               `json:"primarySectionId,omitempty"`
	Members          []crossListMemberJSON `json:"members"`
}

func groupToJSON(g *crosslisting.GroupWithMembers) crossListGroupJSON {
	out := crossListGroupJSON{
		ID:        g.ID.String(),
		CourseID:  g.CourseID.String(),
		Name:      g.Name,
		CreatedAt: g.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		Members:   nil,
	}
	if g.PrimarySectionID != nil {
		s := g.PrimarySectionID.String()
		out.PrimarySectionID = &s
	}
	for _, m := range g.Members {
		sid := m.SectionID.String()
		out.Members = append(out.Members, crossListMemberJSON{
			SectionID:   sid,
			IsPrimary:   m.IsPrimary,
			SectionCode: m.SectionCode,
			SectionName: m.SectionName,
		})
	}
	return out
}

// GET /api/v1/orgs/:orgId/cross-list-groups
func (d Deps) handleOrgCrossListGroupsGet() http.HandlerFunc {
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
		list, err := crosslisting.ListForOrg(r.Context(), d.Pool, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load cross-list groups.")
			return
		}
		out := make([]crossListGroupJSON, 0, len(list))
		for i := range list {
			out = append(out, groupToJSON(&list[i]))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string][]crossListGroupJSON{"groups": out})
	}
}

func (d Deps) handleOrgCrossListGroupsPost() http.HandlerFunc {
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
		if _, _, ok := d.adminOrgOrUnitAccess(w, r, orgID); !ok {
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var body struct {
			CourseCode       string  `json:"courseCode"`
			PrimarySectionID string  `json:"primarySectionId"`
			Name             *string `json:"name"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		cc := strings.TrimSpace(body.CourseCode)
		if cc == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "courseCode is required.")
			return
		}
		psid, err := uuid.Parse(strings.TrimSpace(body.PrimarySectionID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "primarySectionId is required.")
			return
		}
		courseID, err := course.GetIDByCourseCode(r.Context(), d.Pool, cc)
		if err != nil || courseID == nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to resolve course.")
			return
		}
		cOrg, err := course.CourseOrgID(r.Context(), d.Pool, cc)
		if err != nil || cOrg == nil || *cOrg != orgID {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Course is not in this organization.")
			return
		}
		g, err := crosslisting.CreateGroup(r.Context(), d.Pool, orgID, *courseID, psid, body.Name)
		if err != nil {
			switch {
			case errors.Is(err, crosslisting.ErrWrongOrg):
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Section does not belong to this course or organization.")
			case errors.Is(err, crosslisting.ErrCourseHasGroup):
				apierr.WriteJSON(w, http.StatusConflict, apierr.CodeConflict, "This course already has a cross-list group.")
			case errors.Is(err, crosslisting.ErrSectionBusy):
				apierr.WriteJSON(w, http.StatusConflict, apierr.CodeConflict, "That section is already in a cross-list group.")
			default:
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			}
			return
		}
		if g == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Primary section not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(groupToJSON(g))
	}
}

// POST /api/v1/orgs/:orgId/cross-list-groups/:gid/members
func (d Deps) handleOrgCrossListMembersPost() http.HandlerFunc {
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
		gidStr := strings.TrimSpace(chi.URLParam(r, "gid"))
		groupID, err := uuid.Parse(gidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid group id.")
			return
		}
		if _, _, ok := d.adminOrgOrUnitAccess(w, r, orgID); !ok {
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var body struct {
			SectionID string `json:"sectionId"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		sid, err := uuid.Parse(strings.TrimSpace(body.SectionID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "sectionId is required.")
			return
		}
		var courseID uuid.UUID
		err = d.Pool.QueryRow(r.Context(), `
SELECT course_id FROM course.cross_list_groups WHERE id = $1 AND org_id = $2
`, groupID, orgID).Scan(&courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Cross-list group not found.")
			return
		}
		g, err := crosslisting.AddMember(r.Context(), d.Pool, orgID, courseID, sid)
		if err != nil {
			switch {
			case errors.Is(err, crosslisting.ErrWrongOrg):
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Section does not belong to this course or organization.")
			case errors.Is(err, crosslisting.ErrTooManyMembers):
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Cross-list group cannot exceed 10 sections.")
			case errors.Is(err, crosslisting.ErrSectionBusy):
				apierr.WriteJSON(w, http.StatusConflict, apierr.CodeConflict, "That section is already in a cross-list group.")
			default:
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			}
			return
		}
		if g == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Section not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(groupToJSON(g))
	}
}

// DELETE /api/v1/orgs/:orgId/cross-list-groups/:gid/members/:sid
func (d Deps) handleOrgCrossListMemberDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgIDStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		gidStr := strings.TrimSpace(chi.URLParam(r, "gid"))
		groupID, err := uuid.Parse(gidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid group id.")
			return
		}
		sidStr := strings.TrimSpace(chi.URLParam(r, "sid"))
		secID, err := uuid.Parse(sidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid section id.")
			return
		}
		if _, _, ok := d.adminOrgOrUnitAccess(w, r, orgID); !ok {
			return
		}
		var courseID uuid.UUID
		err = d.Pool.QueryRow(r.Context(), `
SELECT course_id FROM course.cross_list_groups WHERE id = $1 AND org_id = $2
`, groupID, orgID).Scan(&courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Cross-list group not found.")
			return
		}
		g, err := crosslisting.RemoveMember(r.Context(), d.Pool, orgID, courseID, secID)
		if errors.Is(err, crosslisting.ErrCannotRemovePrimary) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Cannot remove the primary section from the group.")
			return
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update cross-list group.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if g == nil {
			_ = json.NewEncoder(w).Encode(map[string]any{"removed": true})
			return
		}
		_ = json.NewEncoder(w).Encode(groupToJSON(g))
	}
}
