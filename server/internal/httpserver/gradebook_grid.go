package httpserver

import (
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"

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
	"github.com/lextures/lextures/server/internal/repos/crosslisting"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/gradingschemes"
	"github.com/lextures/lextures/server/internal/courseroles"
)

// gradebookGridColumn is the JSON column shape for the gradebook grid.
type gradebookGridColumn struct {
	ID                    string          `json:"id"`
	Kind                  string          `json:"kind"`
	Title                 string          `json:"title"`
	MaxPoints             *int            `json:"maxPoints"`
	AssignmentGroupID     *string         `json:"assignmentGroupId,omitempty"`
	Rubric                json.RawMessage `json:"rubric,omitempty"`
	AssignmentGradingType *string         `json:"assignmentGradingType,omitempty"`
	EffectiveDisplayType  string          `json:"effectiveDisplayType,omitempty"`
	PostingPolicy         *string         `json:"postingPolicy,omitempty"`
	ReleaseAt             *string         `json:"releaseAt,omitempty"`
	NeverDrop             bool            `json:"neverDrop"`
	ReplaceWithFinal      bool            `json:"replaceWithFinal"`
}

// handleGradebookGrid is GET /api/v1/courses/{course_code}/gradebook/grid (Rust `gradebook_grid_get_handler`).
func (d Deps) handleGradebookGrid() http.HandlerFunc {
	type studentOut struct {
		UserID      string `json:"userId"`
		DisplayName string `json:"displayName"`
	}
	type schemeSum struct {
		Type      string          `json:"type"`
		ScaleJSON json.RawMessage `json:"scaleJson"`
	}
	type gridResp struct {
		Students            []studentOut                            `json:"students"`
		Columns             []gradebookGridColumn                   `json:"columns"`
		Grades              map[string]map[string]string            `json:"grades,omitempty"`
		DisplayGrades       map[string]map[string]string            `json:"displayGrades,omitempty"`
		RubricScores        map[string]map[string]map[string]string `json:"rubricScores,omitempty"`
		GradeHeld           map[string]map[string]bool              `json:"gradeHeld,omitempty"`
		DroppedGrades       map[string]map[string]bool              `json:"droppedGrades,omitempty"`
		ExcusedGrades       map[string]map[string]bool              `json:"excusedGrades,omitempty"`
		GradingScheme       *schemeSum                              `json:"gradingScheme,omitempty"`
		GradebookCsvEnabled bool                                    `json:"gradebookCsvEnabled"`
		CrossListGroupID    *string                                 `json:"crossListGroupId,omitempty"`
		CrossListMerged     bool                                    `json:"crossListMerged"`
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
		ok, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":gradebook:view")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to view the gradebook.")
			return
		}

		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		courseID := *cid

		qSection := strings.TrimSpace(r.URL.Query().Get("section_id"))
		crossListQP := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("cross_list")))
		mergedCrossList := crossListQP == "1" || crossListQP == "true" || crossListQP == "yes"
		var sectionFilter []uuid.UUID
		if qSection != "" {
			pub, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
			if err == nil && pub != nil && pub.SectionsEnabled {
				sid, err := uuid.Parse(qSection)
				if err == nil {
					sec, err := coursesections.GetByID(r.Context(), d.Pool, courseID, sid)
					if err == nil && sec != nil {
						canManage, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
						if err == nil && canManage {
							sectionFilter = []uuid.UUID{sid}
						}
					}
				}
			}
		}
		if len(sectionFilter) == 0 {
			sectionFilter, err = enrollment.GradebookStudentSectionFilter(r.Context(), d.Pool, courseID, courseCode, viewer, mergedCrossList)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to resolve section scope.")
				return
			}
		} else if mergedCrossList {
			sectionFilter, err = crosslisting.ExpandInstructorSectionFilter(r.Context(), d.Pool, courseID, sectionFilter, true)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to resolve cross-list scope.")
				return
			}
		}
		clGroup, err := crosslisting.GetGroupForCourse(r.Context(), d.Pool, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load cross-list group.")
			return
		}
		var crossListGroupID *string
		crossListMerged := mergedCrossList && clGroup != nil && len(clGroup.Members) >= 2
		if crossListMerged && clGroup != nil {
			s := clGroup.ID.String()
			crossListGroupID = &s
			slog.Info("gradebook.cross_list", "cross_list_group_id", clGroup.ID.String(), "course_code", courseCode)
		}
		var stuRows []struct {
			UserID      uuid.UUID
			DisplayName string
		}
		if len(sectionFilter) > 0 {
			stuRows, err = enrollment.ListStudentUsersForCourseCode(r.Context(), d.Pool, courseCode, sectionFilter)
		} else {
			stuRows, err = enrollment.ListStudentUsersForCourseCode(r.Context(), d.Pool, courseCode, nil)
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load students.")
			return
		}
		students := make([]studentOut, 0, len(stuRows))
		for _, s := range stuRows {
			students = append(students, studentOut{UserID: s.UserID.String(), DisplayName: s.DisplayName})
		}

		items, err := coursestructure.ListForCourseWithEnrichment(r.Context(), d.Pool, courseID, true)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course structure.")
			return
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
		var schemePtr *schemeSum
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
			schemePtr = &schemeSum{Type: schemeRow.GradingDisplayType, ScaleJSON: sjson}
		} else {
			p := gradingdisplay.ParsedScale{Kind: gradingdisplay.Points}
			parsed = &p
		}

		// Enrich effective display + merge columns
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

		grades, rubricScores, postedAt, excused, err := coursegrades.ListForCourse(r.Context(), d.Pool, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load grades.")
			return
		}

		display := gridDisplayGrades(grades, outCols, parsed, excused)

		droppedByStudent := make(map[string]map[string]bool)
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
		for _, s := range students {
			earned := make(map[uuid.UUID]float64)
			if g, ok := grades[s.UserID]; ok {
				for iid, ptsStr := range g {
					id, err := uuid.Parse(iid)
					if err != nil {
						continue
					}
					earned[id] = parseGradebookPoints(ptsStr)
				}
			}
			exc := make(map[uuid.UUID]bool)
			if e, ok := excused[s.UserID]; ok {
				for iid, b := range e {
					id, err := uuid.Parse(iid)
					if err != nil {
						continue
					}
					exc[id] = b
				}
			}
			dmap := gradingdrops.ItemDropsForLearner(gpol, colMeta, earned, exc)
			if len(dmap) == 0 {
				continue
			}
			droppedByStudent[s.UserID] = make(map[string]bool)
			for k, v := range dmap {
				if v {
					droppedByStudent[s.UserID][k.String()] = true
				}
			}
		}

		gradeHeld := make(map[string]map[string]bool)
		for u, byItem := range grades {
			for it := range byItem {
				itemID, err := uuid.Parse(it)
				if err != nil {
					continue
				}
				cw, ok := metaByID[itemID]
				if !ok {
					continue
				}
				if cw.out.PostingPolicy == nil || *cw.out.PostingPolicy != "manual" {
					continue
				}
				if p, ok2 := postedAt[u]; ok2 {
					if t, ok3 := p[it]; ok3 && t != nil {
						continue
					}
				}
				if gradeHeld[u] == nil {
					gradeHeld[u] = make(map[string]bool)
				}
				gradeHeld[u][it] = true
			}
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(gridResp{
			Students:            students,
			Columns:             outCols,
			Grades:              grades,
			DisplayGrades:       display,
			RubricScores:        rubricScores,
			GradeHeld:           gradeHeld,
			DroppedGrades:       droppedByStudent,
			ExcusedGrades:       excused,
			GradingScheme:       schemePtr,
			GradebookCsvEnabled: d.effectiveConfig().GradebookCSVEnabled,
			CrossListGroupID:    crossListGroupID,
			CrossListMerged:     crossListMerged,
		})
	}
}

func gradebookMaxPoints(item *coursestructure.ItemResponse) *int {
	if item.PointsWorth != nil {
		v := *item.PointsWorth
		return &v
	}
	if item.Kind == "quiz" && (item.IsAdaptive == nil || !*item.IsAdaptive) {
		if item.PointsPossible != nil {
			v := *item.PointsPossible
			return &v
		}
	}
	return nil
}

func parseGradebookPoints(s string) float64 {
	t := strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if t == "" {
		return 0
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return 0
	}
	if isBadNum(f) || f < 0 {
		return 0
	}
	return f
}

func isBadNum(f float64) bool { return math.IsNaN(f) || math.IsInf(f, 0) }

func gridDisplayGrades(
	grades map[string]map[string]string,
	columns []gradebookGridColumn,
	parsed *gradingdisplay.ParsedScale,
	excused map[string]map[string]bool,
) map[string]map[string]string {
	out := make(map[string]map[string]string)
	colByID := make(map[uuid.UUID]gradebookGridColumn)
	for _, c := range columns {
		id, _ := uuid.Parse(c.ID)
		colByID[id] = c
	}
	for su, row := range grades {
		exMap := excused[su]
		for iid, ptsStr := range row {
			if exMap != nil && exMap[iid] {
				if out[su] == nil {
					out[su] = make(map[string]string)
				}
				out[su][iid] = "EX"
				continue
			}
			pts := parseGradebookPoints(ptsStr)
			if isBadNum(pts) || pts < 0 {
				continue
			}
			id, err := uuid.Parse(iid)
			if err != nil {
				continue
			}
			col, ok := colByID[id]
			if !ok {
				continue
			}
			effK, _ := gradingdisplay.ParseKind(col.EffectiveDisplayType)
			dg := gradingdisplay.ToDisplayGrade(pts, col.MaxPoints, parsed, effK)
			if out[su] == nil {
				out[su] = make(map[string]string)
			}
			out[su][iid] = dg
		}
	}
	return out
}
