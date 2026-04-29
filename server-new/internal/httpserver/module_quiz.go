package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
	"github.com/lextures/lextures/server-new/internal/relativeschedule"
	"github.com/lextures/lextures/server-new/internal/repos/course"
	"github.com/lextures/lextures/server-new/internal/repos/coursemodulequizzes"
	"github.com/lextures/lextures/server-new/internal/repos/coursestructure"
	"github.com/lextures/lextures/server-new/internal/repos/questionbank"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
)

func effectiveLockdownMode(courseLockdownEnabled bool, rowSetting string) string {
	if !courseLockdownEnabled {
		return "standard"
	}
	switch strings.TrimSpace(rowSetting) {
	case "one_at_a_time":
		return "one_at_a_time"
	case "kiosk":
		return "kiosk"
	default:
		return "standard"
	}
}

func buildModuleQuizResponse(
	itemID uuid.UUID,
	row *coursemodulequizzes.CourseItemQuizRow,
	canEdit bool,
	shift *relativeschedule.Context,
	meta *course.CourseQuizMeta,
	questions []coursemodulequiz.QuizQuestion,
	usesServerQuestionSampling bool,
) coursemodulequiz.ModuleQuizResponse {
	due := shiftMaybe(shift, row.DueAt)
	avF := shiftMaybe(shift, row.AvailableFrom)
	avU := shiftMaybe(shift, row.AvailableUntil)
	requires := row.QuizAccessCode != nil && strings.TrimSpace(*row.QuizAccessCode) != ""
	var quizAccess *string
	if canEdit && row.QuizAccessCode != nil {
		if s := strings.TrimSpace(*row.QuizAccessCode); s != "" {
			quizAccess = &s
		}
	}
	rawLockdown := row.LockdownMode
	lockdownOut := rawLockdown
	var focus *int32
	if canEdit {
		focus = row.FocusLossThreshold
	} else {
		lockdownOut = effectiveLockdownMode(meta.LockdownModeEnabled, rawLockdown)
		focus = nil
	}
	var adaptivePrompt *string
	var adaptiveSources []uuid.UUID
	if canEdit && row.IsAdaptive {
		if strings.TrimSpace(row.AdaptiveSystemPrompt) != "" {
			s := row.AdaptiveSystemPrompt
			adaptivePrompt = &s
		}
		if len(row.AdaptiveSourceItemIDs) > 0 {
			adaptiveSources = append([]uuid.UUID(nil), row.AdaptiveSourceItemIDs...)
		}
	}
	return coursemodulequiz.ModuleQuizResponse{
		ItemID:                        itemID,
		Title:                         row.Title,
		Markdown:                      row.Markdown,
		DueAt:                         due,
		AvailableFrom:                 avF,
		AvailableUntil:                avU,
		UnlimitedAttempts:             row.UnlimitedAttempts,
		MaxAttempts:                   row.MaxAttempts,
		GradeAttemptPolicy:            row.GradeAttemptPolicy,
		PassingScorePercent:           row.PassingScorePercent,
		PointsWorth:                   row.PointsWorth,
		LateSubmissionPolicy:          row.LateSubmissionPolicy,
		LatePenaltyPercent:            row.LatePenaltyPercent,
		TimeLimitMinutes:              row.TimeLimitMinutes,
		TimerPauseWhenTabHidden:       row.TimerPauseWhenTabHidden,
		PerQuestionTimeLimitSeconds:   row.PerQuestionTimeLimitSeconds,
		ShowScoreTiming:               row.ShowScoreTiming,
		ReviewVisibility:              row.ReviewVisibility,
		ReviewWhen:                    row.ReviewWhen,
		OneQuestionAtATime:            row.OneQuestionAtATime,
		ShuffleQuestions:              row.ShuffleQuestions,
		ShuffleChoices:                row.ShuffleChoices,
		AllowBackNavigation:           row.AllowBackNavigation,
		LockdownMode:                  lockdownOut,
		FocusLossThreshold:            focus,
		RequiresQuizAccessCode:        requires,
		QuizAccessCode:                quizAccess,
		AdaptiveDifficulty:            row.AdaptiveDifficulty,
		AdaptiveTopicBalance:          row.AdaptiveTopicBalance,
		AdaptiveStopRule:            row.AdaptiveStopRule,
		RandomQuestionPoolCount:       row.RandomQuestionPoolCount,
		Questions:                     questions,
		UsesServerQuestionSampling:    usesServerQuestionSampling,
		UpdatedAt:                     row.UpdatedAt,
		IsAdaptive:                    row.IsAdaptive,
		AdaptiveSystemPrompt:          adaptivePrompt,
		AdaptiveSourceItemIDs:         adaptiveSources,
		AdaptiveQuestionCount:         row.AdaptiveQuestionCount,
		AdaptiveDeliveryMode:          row.AdaptiveDeliveryMode,
		AssignmentGroupID:            row.AssignmentGroupID,
		HintScaffoldingEnabled:        meta.HintScaffoldingEnabled,
		MisconceptionDetectionEnabled: meta.MisconceptionDetectionEnabled,
		NeverDrop:                     row.NeverDrop,
		ReplaceWithFinal:              row.ReplaceWithFinal,
	}
}

// handleGetModuleQuiz is GET /api/v1/courses/{course_code}/quizzes/{item_id}.
func (d Deps) handleGetModuleQuiz() http.HandlerFunc {
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
		meta, err := course.GetCourseQuizMeta(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if meta == nil {
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
			visible, err := coursestructure.QuizVisibleToStudent(r.Context(), d.Pool, *cid, itemID, viewer, time.Now().UTC())
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check quiz access.")
				return
			}
			if !visible {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
		}
		row, err := coursemodulequizzes.GetForCourseItem(r.Context(), d.Pool, *cid, itemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load quiz.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var shift *relativeschedule.Context
		if !canEdit {
			shift, err = relativeschedule.LoadForUser(r.Context(), d.Pool, *cid, viewer)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course schedule.")
				return
			}
		}
		var attemptID *uuid.UUID
		if !canEdit {
			if s := strings.TrimSpace(r.URL.Query().Get("attemptId")); s != "" {
				id, perr := uuid.Parse(s)
				if perr != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid attemptId.")
					return
				}
				attemptID = &id
			}
		}
		resolved, usesServer, err := questionbank.ResolveDeliveryQuestionsForGet(
			r.Context(), d.Pool, *cid, itemID,
			meta.QuestionBankEnabled,
			row.Questions,
			attemptID,
			canEdit,
		)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		if !canEdit {
			resolved = coursemodulequiz.SanitizeQuizQuestionsForLearner(resolved)
		}
		out := buildModuleQuizResponse(itemID, row, canEdit, shift, meta, resolved, usesServer)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}
