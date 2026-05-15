package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/gradingdisplay"
	"github.com/lextures/lextures/server/internal/gradingdrops"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursegrades"
	"github.com/lextures/lextures/server/internal/repos/coursegrading"
	"github.com/lextures/lextures/server/internal/repos/coursemoduleassignments"
	"github.com/lextures/lextures/server/internal/repos/coursesections"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/gradingschemes"
)

// handleCourseMyGrades is GET /api/v1/courses/{course_code}/my-grades.
// Student-only: returns this learner's grade row, display labels, drops, holds, and excused statuses.
func (d Deps) handleCourseMyGrades() http.HandlerFunc {
	type schemeOut struct {
		Type      string          `json:"type"`
		ScaleJSON json.RawMessage `json:"scaleJson"`
	}
	type resp struct {
		Columns          []gradebookGridColumn                 `json:"columns"`
		Grades           map[string]string                     `json:"grades"`
		DisplayGrades    map[string]string                     `json:"displayGrades,omitempty"`
		AssignmentGroups []coursegrading.AssignmentGroupPublic `json:"assignmentGroups,omitempty"`
		HeldGradeItemIds []string                              `json:"heldGradeItemIds,omitempty"`
		DroppedGrades    map[string]bool                       `json:"droppedGrades,omitempty"`
		GradeStatuses    map[string]string                     `json:"gradeStatuses,omitempty"`
		GradingScheme    *schemeOut                            `json:"gradingScheme,omitempty"`
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

		isStudent, err := enrollment.UserHasEnrollmentRole(r.Context(), d.Pool, courseCode, viewer, "student")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify enrollment.")
			return
		}
		if !isStudent {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "My grades are only available to student enrollments.")
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
		courseID := *cid

		items, err := coursestructure.ListForCourseWithEnrichment(r.Context(), d.Pool, courseID, false)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course structure.")
			return
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err == nil && crow != nil && crow.SectionsEnabled {
			secID, err := enrollment.GetStudentSectionID(r.Context(), d.Pool, courseID, viewer)
			if err == nil && secID != nil {
				ovm, err := coursesections.ListOverridesForSection(r.Context(), d.Pool, *secID)
				if err == nil && len(ovm) > 0 {
					applySectionAssignmentOverrides(items, ovm)
				}
			}
		}

		var assignIDs []uuid.UUID
		for i := range items {
			if items[i].Kind == "assignment" {
				id, e := uuid.Parse(items[i].ID)
				if e == nil {
					assignIDs = append(assignIDs, id)
				}
			}
		}

		rubricMap, err := coursemoduleassignments.RubricByItemID(r.Context(), d.Pool, courseID, assignIDs)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load rubrics.")
			return
		}
		postingMap, err := coursemoduleassignments.PostingByItemID(r.Context(), d.Pool, courseID, assignIDs)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load posting settings.")
			return
		}
		typeMap, err := coursemoduleassignments.GradingTypeByItemID(r.Context(), d.Pool, courseID, assignIDs)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load grading types.")
			return
		}
		dropFlags, err := coursemoduleassignments.ItemDropFlagsForCourse(r.Context(), d.Pool, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load drop flags.")
			return
		}

		type colWork struct {
			out    gradebookGridColumn
			id     uuid.UUID
			maxVal *int
		}
		var cols []colWork
		for i := range items {
			if items[i].Kind != "assignment" && items[i].Kind != "quiz" {
				continue
			}
			itemID, err := uuid.Parse(items[i].ID)
			if err != nil {
				continue
			}
			mp := gradebookMaxPoints(&items[i])
			var ag *string
			if items[i].AssignmentGroupID != nil {
				ag = items[i].AssignmentGroupID
			}
			df := dropFlags[itemID]
			c := gradebookGridColumn{
				ID:                items[i].ID,
				Kind:              items[i].Kind,
				Title:             items[i].Title,
				MaxPoints:         mp,
				AssignmentGroupID: ag,
				NeverDrop:         df.NeverDrop,
				ReplaceWithFinal:  df.ReplaceWithFinal,
			}
			if raw, ok := rubricMap[itemID]; ok && len(raw) > 0 {
				c.Rubric = append(json.RawMessage(nil), raw...)
			}
			if items[i].Kind == "assignment" {
				if gt, ok := typeMap[itemID]; ok && gt != nil {
					c.AssignmentGradingType = gt
				}
				if p, ok := postingMap[itemID]; ok {
					pp := p.Policy
					c.PostingPolicy = &pp
					if p.ReleaseAt != nil {
						s := p.ReleaseAt.UTC().Format("2006-01-02T15:04:05.000Z")
						c.ReleaseAt = &s
					}
				}
			}
			cols = append(cols, colWork{out: c, id: itemID, maxVal: mp})
		}

		schemeRow, err := gradingschemes.GetActiveForCourse(r.Context(), d.Pool, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load grading scheme.")
			return
		}
		var courseKind *gradingdisplay.Kind
		var parsed *gradingdisplay.ParsedScale
		var schemePtr *schemeOut
		if schemeRow != nil {
			k, ok := gradingdisplay.ParseKind(schemeRow.GradingDisplayType)
			if !ok {
				k = gradingdisplay.Points
			}
			courseKind = &k
			ps, err := gradingdisplay.ParseScale(k, schemeRow.ScaleJSON)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Stored grading scheme is invalid.")
				return
			}
			parsed = &ps
			var sjson json.RawMessage
			if schemeRow.ScaleJSON != nil {
				sjson = append(json.RawMessage(nil), (*schemeRow.ScaleJSON)...)
			} else {
				sjson = json.RawMessage(`{}`)
			}
			schemePtr = &schemeOut{Type: schemeRow.GradingDisplayType, ScaleJSON: sjson}
		} else {
			p := gradingdisplay.ParsedScale{Kind: gradingdisplay.Points}
			parsed = &p
		}

		outCols := make([]gradebookGridColumn, 0, len(cols))
		metaByID := make(map[uuid.UUID]colWork)
		for i := range cols {
			ov := cols[i].out.AssignmentGradingType
			eff := gradingdisplay.ResolveEffective(courseKind, ov)
			cols[i].out.EffectiveDisplayType = eff.String()
			outCols = append(outCols, cols[i].out)
			metaByID[cols[i].id] = cols[i]
		}

		groups, err := coursegrading.ListAssignmentGroups(r.Context(), d.Pool, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load assignment groups.")
			return
		}
		gpol := gradingdrops.GroupPoliciesFromSettings(groups)

		grades, _, postedAt, excused, err := coursegrades.ListForCourse(r.Context(), d.Pool, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load grades.")
			return
		}

		display := gridDisplayGrades(grades, outCols, parsed, excused)

		colMeta := make([]gradingdrops.ColMeta, 0, len(cols))
		for i := range cols {
			if cols[i].maxVal == nil || *cols[i].maxVal <= 0 {
				continue
			}
			var gptr *uuid.UUID
			if cols[i].out.AssignmentGroupID != nil {
				if gu, e := uuid.Parse(*cols[i].out.AssignmentGroupID); e == nil {
					gptr = &gu
				}
			}
			mf := float64(*cols[i].maxVal)
			colMeta = append(colMeta, gradingdrops.ColMeta{ID: cols[i].id, GroupID: gptr, Max: mf, NeverDrop: cols[i].out.NeverDrop, ReplaceWithFinal: cols[i].out.ReplaceWithFinal})
		}

		uidStr := viewer.String()

		var droppedOne map[string]bool
		earned := make(map[uuid.UUID]float64)
		if g, ok := grades[uidStr]; ok {
			for iid, ptsStr := range g {
				id, err := uuid.Parse(iid)
				if err != nil {
					continue
				}
				earned[id] = parseGradebookPoints(ptsStr)
			}
		}
		ex := make(map[uuid.UUID]bool)
		if e, ok := excused[uidStr]; ok {
			for iid, b := range e {
				id, err := uuid.Parse(iid)
				if err != nil {
					continue
				}
				ex[id] = b
			}
		}
		dmap := gradingdrops.ItemDropsForLearner(gpol, colMeta, earned, ex)
		if len(dmap) > 0 {
			droppedOne = make(map[string]bool)
			for k, v := range dmap {
				if v {
					droppedOne[k.String()] = true
				}
			}
		}

		var heldIDs []string
		if gRow, ok := grades[uidStr]; ok {
			for it := range gRow {
				itemUUID, err := uuid.Parse(it)
				if err != nil {
					continue
				}
				cw, ok := metaByID[itemUUID]
				if !ok {
					continue
				}
				if cw.out.PostingPolicy == nil || *cw.out.PostingPolicy != "manual" {
					continue
				}
				if p, ok2 := postedAt[uidStr]; ok2 {
					if t, ok3 := p[it]; ok3 && t != nil {
						continue
					}
				}
				heldIDs = append(heldIDs, it)
			}
		}

		gradeStatuses := make(map[string]string)
		if xu, ok := excused[uidStr]; ok {
			for itemID, isEx := range xu {
				if isEx {
					gradeStatuses[itemID] = "excused"
				}
			}
		}

		outGr := map[string]string{}
		if g, ok := grades[uidStr]; ok && g != nil {
			for k, v := range g {
				outGr[k] = v
			}
		}
		disRow := map[string]string{}
		if dg, ok := display[uidStr]; ok && dg != nil {
			for k, v := range dg {
				disRow[k] = v
			}
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{
			Columns:          outCols,
			Grades:           outGr,
			DisplayGrades:    disRow,
			AssignmentGroups: groups,
			HeldGradeItemIds: heldIDs,
			DroppedGrades:    droppedOne,
			GradeStatuses:    gradeStatuses,
			GradingScheme:    schemePtr,
		})
	}
}
