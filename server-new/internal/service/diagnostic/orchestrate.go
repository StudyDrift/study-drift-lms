package diagnostic

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
	"github.com/lextures/lextures/server-new/internal/repos/adaptivepath"
	"github.com/lextures/lextures/server-new/internal/repos/concepts"
	"github.com/lextures/lextures/server-new/internal/repos/coursestructure"
	diagrepo "github.com/lextures/lextures/server-new/internal/repos/diagnostic"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
	"github.com/lextures/lextures/server-new/internal/repos/learnermodel"
	"github.com/lextures/lextures/server-new/internal/repos/questionbank"
	"github.com/lextures/lextures/server-new/internal/service/adaptivequizcat"
	"github.com/lextures/lextures/server-new/internal/service/irt"
)

var defaultThetaCuts = [3]float64{-1, 0, 1}

func isCalibrated(e *questionbank.QuestionEntity) bool {
	if e == nil || e.IrtStatus != "calibrated" || e.IrtA == nil || e.IrtB == nil {
		return false
	}
	return *e.IrtA > 0.01
}

func conceptsForEntity(ent *questionbank.QuestionEntity, tagMap map[uuid.UUID][]uuid.UUID, diagnosticConcepts []uuid.UUID) []uuid.UUID {
	if ent == nil {
		return nil
	}
	if v := tagMap[ent.ID]; len(v) > 0 {
		return slices.Clone(v)
	}
	var fromMeta []uuid.UUID
	if len(ent.Metadata) > 0 {
		var meta struct {
			ConceptIDs []string `json:"conceptIds"`
		}
		if err := json.Unmarshal(ent.Metadata, &meta); err == nil {
			for _, s := range meta.ConceptIDs {
				id, err := uuid.Parse(s)
				if err != nil {
					continue
				}
				if slices.Contains(diagnosticConcepts, id) {
					fromMeta = append(fromMeta, id)
				}
			}
		}
	}
	slices.SortFunc(fromMeta, func(a, b uuid.UUID) int {
		return strings.Compare(a.String(), b.String())
	})
	fromMeta = slices.Compact(fromMeta)
	if len(fromMeta) > 0 {
		return fromMeta
	}
	if len(diagnosticConcepts) > 0 {
		return []uuid.UUID{diagnosticConcepts[0]}
	}
	return nil
}

func bankAnswerIsCorrect(ent *questionbank.QuestionEntity, choiceIndex int) bool {
	if ent == nil {
		return false
	}
	switch ent.QuestionType {
	case "true_false":
		var b bool
		if ent.CorrectAnswer != nil {
			_ = json.Unmarshal(ent.CorrectAnswer, &b)
		}
		return (choiceIndex == 0) == b
	case "mc_single", "mc_multiple":
		var obj struct {
			Index uint64 `json:"index"`
		}
		if ent.CorrectAnswer != nil {
			_ = json.Unmarshal(ent.CorrectAnswer, &obj)
		}
		return int(obj.Index) == choiceIndex
	default:
		return false
	}
}

type placementRuleRow struct {
	ConceptID    uuid.UUID `json:"conceptId"`
	MasteryBelow float64   `json:"masteryBelow"`
	StartItemID  uuid.UUID `json:"startItemId"`
}

func placementItemFromRules(placementRules json.RawMessage, mastery map[uuid.UUID]float64, fallback uuid.UUID) uuid.UUID {
	if len(placementRules) == 0 {
		return fallback
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(placementRules, &arr); err != nil {
		return fallback
	}
	for _, raw := range arr {
		var r placementRuleRow
		if err := json.Unmarshal(raw, &r); err != nil {
			continue
		}
		m := mastery[r.ConceptID]
		if m+1e-12 < r.MasteryBelow {
			return r.StartItemID
		}
	}
	return fallback
}

func shouldFinishDiagnostic(answered int, maxItems int32, stoppingRule string, seThreshold, pooledSE float64) bool {
	if answered >= int(maxItems) {
		return true
	}
	if answered < 3 {
		return false
	}
	switch stoppingRule {
	case "se_threshold", "both":
		return pooledSE <= seThreshold
	default:
		return false
	}
}

func parseThetaCuts(raw json.RawMessage) *[3]float64 {
	if len(raw) == 0 {
		return nil
	}
	var arr []float64
	if err := json.Unmarshal(raw, &arr); err != nil || len(arr) < 3 {
		return nil
	}
	c := [3]float64{arr[0], arr[1], arr[2]}
	return &c
}

func thetaToMastery(theta float64) float64 {
	x := math.Exp(-theta)
	return math.Min(1, math.Max(0, 1/(1+x)))
}

func proficiencyForTheta(theta float64, cuts *[3]float64) (key, label string) {
	c := defaultThetaCuts
	if cuts != nil {
		c = *cuts
	}
	switch {
	case theta < c[0]:
		return "diagnostic.proficiency.beginner", "Beginner"
	case theta < c[1]:
		return "diagnostic.proficiency.developing", "Developing"
	case theta < c[2]:
		return "diagnostic.proficiency.proficient", "Proficient"
	default:
		return "diagnostic.proficiency.advanced", "Advanced"
	}
}

func pickNextQuestionID(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID uuid.UUID,
	diagnostic *diagrepo.CourseDiagnosticRow,
	used map[uuid.UUID]struct{},
	history [][3]float64,
	counts map[uuid.UUID]int,
) (*uuid.UUID, error) {
	poolIDs, err := questionbank.ListActiveDiagnosticQuestionIDs(ctx, pool, courseID, diagnostic.ConceptIDs)
	if err != nil {
		return nil, err
	}
	var available []uuid.UUID
	for _, id := range poolIDs {
		if _, ok := used[id]; !ok {
			available = append(available, id)
		}
	}
	if len(available) == 0 {
		return nil, nil
	}
	var entities []*questionbank.QuestionEntity
	for _, pid := range available {
		e, err := questionbank.GetQuestionForCourse(ctx, pool, courseID, pid)
		if err != nil {
			return nil, err
		}
		if e != nil {
			entities = append(entities, e)
		}
	}
	if len(entities) == 0 {
		return nil, nil
	}
	tagRows, err := questionbank.ListConceptTagsForQuestions(ctx, pool, available, diagnostic.ConceptIDs)
	if err != nil {
		return nil, err
	}
	tagMap := make(map[uuid.UUID][]uuid.UUID)
	for _, r := range tagRows {
		tagMap[r.QuestionID] = append(tagMap[r.QuestionID], r.ConceptID)
	}
	for k := range tagMap {
		slices.SortFunc(tagMap[k], func(a, b uuid.UUID) int {
			return strings.Compare(a.String(), b.String())
		})
		tagMap[k] = slices.Compact(tagMap[k])
	}
	calibratedAny := false
	for _, e := range entities {
		if isCalibrated(e) {
			calibratedAny = true
			break
		}
	}
	catOn := irt.CatModeEnabled() && calibratedAny
	if catOn {
		thetaHat, _ := irt.EapTheta2pl(history)
		cands := make([]struct {
			ID   uuid.UUID
			A, B *float64
		}, 0, len(entities))
		for _, e := range entities {
			cands = append(cands, struct {
				ID   uuid.UUID
				A, B *float64
			}{ID: e.ID, A: e.IrtA, B: e.IrtB})
		}
		exclude := make([]uuid.UUID, 0, len(used))
		for id := range used {
			exclude = append(exclude, id)
		}
		if pid := irt.SelectMaxInformationItem(thetaHat, cands, exclude, true); pid != nil {
			return pid, nil
		}
		if pid := irt.SelectMaxInformationItem(thetaHat, cands, exclude, false); pid != nil {
			return pid, nil
		}
	}
	var bestConcept *uuid.UUID
	bestCount := math.MaxInt
	for _, cid := range diagnostic.ConceptIDs {
		c := counts[cid]
		hasUnused := false
		for _, e := range entities {
			for _, x := range conceptsForEntity(e, tagMap, diagnostic.ConceptIDs) {
				if x == cid {
					hasUnused = true
					break
				}
			}
			if hasUnused {
				break
			}
		}
		if !hasUnused {
			continue
		}
		if c < bestCount {
			bestCount = c
			id := cid
			bestConcept = &id
		}
	}
	targetConcept := diagnostic.ConceptIDs[0]
	if bestConcept != nil {
		targetConcept = *bestConcept
	}
	var candIDs []uuid.UUID
	for _, e := range entities {
		for _, cid := range conceptsForEntity(e, tagMap, diagnostic.ConceptIDs) {
			if cid == targetConcept {
				candIDs = append(candIDs, e.ID)
				break
			}
		}
	}
	if len(candIDs) == 0 {
		for _, e := range entities {
			candIDs = append(candIDs, e.ID)
		}
	}
	rand.Shuffle(len(candIDs), func(i, j int) {
		candIDs[i], candIDs[j] = candIDs[j], candIDs[i]
	})
	if len(candIDs) == 0 {
		return nil, nil
	}
	out := candIDs[0]
	return &out, nil
}

// PlacementConceptSummary is part of the completed diagnostic payload.
type PlacementConceptSummary struct {
	ConceptID        uuid.UUID `json:"conceptId"`
	Name             string    `json:"name"`
	Theta            float64   `json:"theta"`
	Mastery          float64   `json:"mastery"`
	ProficiencyKey   string    `json:"proficiencyKey"`
	ProficiencyLabel string    `json:"proficiencyLabel"`
}

// PlacementSummary is returned when a diagnostic finishes.
type PlacementSummary struct {
	Concepts        []PlacementConceptSummary `json:"concepts"`
	PlacementItemID uuid.UUID                 `json:"placementItemId"`
	PlacementTitle  string                    `json:"placementTitle"`
}

func finalizePlacement(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID, enrollmentID, userID uuid.UUID,
	diagnostic *diagrepo.CourseDiagnosticRow,
	attemptID uuid.UUID,
	responses []json.RawMessage,
) (thetaSummary json.RawMessage, placementSummary json.RawMessage, placementID uuid.UUID, err error) {
	perConcept := make(map[uuid.UUID][][3]float64)
	for _, raw := range responses {
		var turn struct {
			QuestionID string `json:"questionId"`
			Correct    bool   `json:"correct"`
		}
		if err := json.Unmarshal(raw, &turn); err != nil {
			return nil, nil, uuid.Nil, fmt.Errorf("invalid diagnostic response log: %w", err)
		}
		qid, err := uuid.Parse(turn.QuestionID)
		if err != nil {
			return nil, nil, uuid.Nil, fmt.Errorf("invalid diagnostic response log")
		}
		ent, err := questionbank.GetQuestionForCourse(ctx, pool, courseID, qid)
		if err != nil {
			return nil, nil, uuid.Nil, err
		}
		if ent == nil || !isCalibrated(ent) {
			continue
		}
		a := 1.0
		b := 0.0
		if ent.IrtA != nil {
			a = *ent.IrtA
		}
		if ent.IrtB != nil {
			b = *ent.IrtB
		}
		u := 0.0
		if turn.Correct {
			u = 1
		}
		tags, err := questionbank.ListQuestionConceptsInSet(ctx, pool, qid, diagnostic.ConceptIDs)
		if err != nil {
			return nil, nil, uuid.Nil, err
		}
		emptyMap := map[uuid.UUID][]uuid.UUID{}
		cids := tags
		if len(cids) == 0 {
			cids = conceptsForEntity(ent, emptyMap, diagnostic.ConceptIDs)
		}
		for _, cid := range cids {
			perConcept[cid] = append(perConcept[cid], [3]float64{a, b, u})
		}
	}
	thetaObj := make(map[string]float64)
	masteryMap := make(map[uuid.UUID]float64)
	for _, cid := range diagnostic.ConceptIDs {
		rows := perConcept[cid]
		th, _ := irt.EapTheta2pl(rows)
		m := thetaToMastery(th)
		thetaObj[cid.String()] = th
		masteryMap[cid] = m
	}
	thetaSummary, err = json.Marshal(thetaObj)
	if err != nil {
		return nil, nil, uuid.Nil, err
	}
	structRows, err := coursestructure.ListForCourse(ctx, pool, courseID)
	if err != nil {
		return nil, nil, uuid.Nil, err
	}
	structRows = coursestructure.FilterArchivedItems(structRows)
	nav := coursestructure.NavigableIDsInOutlineOrder(structRows)
	if len(nav) == 0 {
		return nil, nil, uuid.Nil, fmt.Errorf("course has no navigable items for placement")
	}
	first := nav[0]
	placementID = placementItemFromRules(diagnostic.PlacementRules, masteryMap, first)
	cuts := parseThetaCuts(diagnostic.ThetaCutScores)
	var conceptsOut []PlacementConceptSummary
	for _, cid := range diagnostic.ConceptIDs {
		th := thetaObj[cid.String()]
		m := masteryMap[cid]
		k, lbl := proficiencyForTheta(th, cuts)
		name, err := concepts.NameInCourse(ctx, pool, courseID, cid)
		if err != nil {
			return nil, nil, uuid.Nil, err
		}
		conceptsOut = append(conceptsOut, PlacementConceptSummary{
			ConceptID:        cid,
			Name:             name,
			Theta:            th,
			Mastery:          m,
			ProficiencyKey:   k,
			ProficiencyLabel: lbl,
		})
	}
	title := "Start here"
	if row, err := coursestructure.GetItemRow(ctx, pool, courseID, placementID); err == nil && row != nil {
		title = row.Title
	}
	ps := PlacementSummary{
		Concepts:        conceptsOut,
		PlacementItemID: placementID,
		PlacementTitle:  title,
	}
	placementSummary, err = json.Marshal(ps)
	if err != nil {
		return nil, nil, uuid.Nil, err
	}
	pos := 0
	for i, id := range nav {
		if id == placementID {
			pos = i
			break
		}
	}
	seq := nav[pos:]
	if len(seq) > 0 {
		if err := adaptivepath.UpsertPathOverride(ctx, pool, enrollmentID, seq, userID); err != nil {
			return nil, nil, uuid.Nil, err
		}
	}
	seeds := make([]learnermodel.DiagnosticSeed, 0, len(diagnostic.ConceptIDs))
	for _, cid := range diagnostic.ConceptIDs {
		rows := perConcept[cid]
		th, se := irt.EapTheta2pl(rows)
		m := thetaToMastery(th)
		n := int32(len(rows))
		if n < 1 {
			n = 1
		}
		seCopy := se
		seeds = append(seeds, learnermodel.DiagnosticSeed{
			ConceptID: cid,
			Theta:     th,
			ThetaSE:   &seCopy,
			Mastery:   m,
			ItemsN:    n,
		})
	}
	if err := learnermodel.ApplyDiagnosticSeedBatch(ctx, pool, userID, attemptID, seeds); err != nil {
		return nil, nil, uuid.Nil, err
	}
	return thetaSummary, placementSummary, placementID, nil
}

// RespondBody is POST /diagnostic-attempts/{id}/respond JSON.
type RespondBody struct {
	QuestionID  uuid.UUID `json:"questionId"`
	ChoiceIndex int       `json:"choiceIndex"`
	ResponseMS  *int32    `json:"responseMs,omitempty"`
}

// RespondResult is the JSON body after answering one item.
type RespondResult struct {
	Completed    bool                                            `json:"completed"`
	NextQuestion *coursemodulequiz.AdaptiveQuizGeneratedQuestion `json:"nextQuestion,omitempty"`
	Summary      *PlacementSummary                               `json:"summary,omitempty"`
}

// RespondDiagnosticAttempt records an answer and either completes or returns the next item.
func RespondDiagnosticAttempt(ctx context.Context, pool *pgxpool.Pool, courseID, userID, attemptID uuid.UUID, body RespondBody) (*RespondResult, error) {
	attempt, err := diagrepo.GetAttemptByID(ctx, pool, attemptID)
	if err != nil {
		return nil, err
	}
	if attempt == nil {
		return nil, fmt.Errorf("%w", ErrNotFound)
	}
	if attempt.CompletedAt != nil {
		return nil, fmt.Errorf("this diagnostic attempt is already finished")
	}
	en, err := enrollment.GetByID(ctx, pool, attempt.EnrollmentID)
	if err != nil {
		return nil, err
	}
	if en == nil {
		return nil, fmt.Errorf("%w", ErrNotFound)
	}
	if en.UserID != userID || en.CourseID != courseID {
		return nil, fmt.Errorf("%w", ErrForbidden)
	}
	diagnostic, err := diagrepo.GetDiagnosticForCourse(ctx, pool, courseID)
	if err != nil {
		return nil, err
	}
	if diagnostic == nil {
		return nil, fmt.Errorf("%w", ErrNotFound)
	}
	if diagnostic.ID != attempt.DiagnosticID {
		return nil, fmt.Errorf("diagnostic mismatch")
	}
	var session struct {
		Pending *string `json:"pendingQuestionId"`
	}
	if err := json.Unmarshal(attempt.SessionState, &session); err != nil || session.Pending == nil {
		return nil, fmt.Errorf("no pending diagnostic question")
	}
	pending, err := uuid.Parse(*session.Pending)
	if err != nil || pending != body.QuestionID {
		return nil, fmt.Errorf("question does not match the current diagnostic item")
	}
	ent, err := questionbank.GetQuestionForCourse(ctx, pool, courseID, body.QuestionID)
	if err != nil {
		return nil, err
	}
	if ent == nil {
		return nil, fmt.Errorf("%w", ErrNotFound)
	}
	correct := bankAnswerIsCorrect(ent, body.ChoiceIndex)
	var respList []json.RawMessage
	if len(attempt.Responses) > 0 {
		_ = json.Unmarshal(attempt.Responses, &respList)
	}
	turn := map[string]any{
		"questionId":  body.QuestionID.String(),
		"choiceIndex": body.ChoiceIndex,
		"correct":     correct,
	}
	if body.ResponseMS != nil {
		turn["responseMs"] = *body.ResponseMS
	}
	nb, err := json.Marshal(turn)
	if err != nil {
		return nil, err
	}
	respList = append(respList, nb)
	used := make(map[uuid.UUID]struct{})
	for _, raw := range respList {
		var t struct {
			QuestionID string `json:"questionId"`
		}
		if json.Unmarshal(raw, &t) == nil {
			if id, err := uuid.Parse(t.QuestionID); err == nil {
				used[id] = struct{}{}
			}
		}
	}
	var history [][3]float64
	for _, raw := range respList {
		var t struct {
			QuestionID string `json:"questionId"`
			Correct    bool   `json:"correct"`
		}
		if json.Unmarshal(raw, &t) != nil {
			continue
		}
		qid, err := uuid.Parse(t.QuestionID)
		if err != nil {
			continue
		}
		qent, err := questionbank.GetQuestionForCourse(ctx, pool, courseID, qid)
		if err != nil || qent == nil || !isCalibrated(qent) {
			continue
		}
		a := 1.0
		b := 0.0
		if qent.IrtA != nil {
			a = *qent.IrtA
		}
		if qent.IrtB != nil {
			b = *qent.IrtB
		}
		u := 0.0
		if t.Correct {
			u = 1
		}
		history = append(history, [3]float64{a, b, u})
	}
	_, pooledSE := irt.EapTheta2pl(history)
	usedIDs := make([]uuid.UUID, 0, len(used))
	for id := range used {
		usedIDs = append(usedIDs, id)
	}
	tagRows, err := questionbank.ListConceptTagsForQuestions(ctx, pool, usedIDs, diagnostic.ConceptIDs)
	if err != nil {
		return nil, err
	}
	tagMap := make(map[uuid.UUID][]uuid.UUID)
	for _, r := range tagRows {
		tagMap[r.QuestionID] = append(tagMap[r.QuestionID], r.ConceptID)
	}
	counts := make(map[uuid.UUID]int)
	for _, raw := range respList {
		var t struct {
			QuestionID string `json:"questionId"`
		}
		if json.Unmarshal(raw, &t) != nil {
			continue
		}
		qid, err := uuid.Parse(t.QuestionID)
		if err != nil {
			continue
		}
		qent, err := questionbank.GetQuestionForCourse(ctx, pool, courseID, qid)
		if err != nil || qent == nil {
			continue
		}
		for _, cid := range conceptsForEntity(qent, tagMap, diagnostic.ConceptIDs) {
			counts[cid]++
		}
	}
	answered := len(respList)
	nextID, err := pickNextQuestionID(ctx, pool, courseID, diagnostic, used, history, counts)
	if err != nil {
		return nil, err
	}
	done := nextID == nil || shouldFinishDiagnostic(answered, diagnostic.MaxItems, diagnostic.StoppingRule, diagnostic.SEThreshold, pooledSE)
	if done {
		th, pl, pid, err := finalizePlacement(ctx, pool, courseID, attempt.EnrollmentID, userID, diagnostic, attemptID, respList)
		if err != nil {
			return nil, err
		}
		respBytes, err := json.Marshal(respList)
		if err != nil {
			return nil, err
		}
		if err := diagrepo.CompleteAttempt(ctx, pool, attemptID, &pid, th, pl, respBytes); err != nil {
			return nil, err
		}
		var summary PlacementSummary
		if err := json.Unmarshal(pl, &summary); err != nil {
			return nil, err
		}
		return &RespondResult{Completed: true, Summary: &summary}, nil
	}
	nextEnt, err := questionbank.GetQuestionForCourse(ctx, pool, courseID, *nextID)
	if err != nil {
		return nil, err
	}
	if nextEnt == nil {
		return nil, fmt.Errorf("%w", ErrNotFound)
	}
	q, err := adaptivequizcat.BankEntityToAdaptiveQuestion(nextEnt)
	if err != nil {
		return nil, err
	}
	sessOut, _ := json.Marshal(map[string]string{"pendingQuestionId": nextID.String()})
	respBytes, err := json.Marshal(respList)
	if err != nil {
		return nil, err
	}
	if err := diagrepo.UpdateAttemptSession(ctx, pool, attemptID, sessOut, respBytes); err != nil {
		return nil, err
	}
	return &RespondResult{Completed: false, NextQuestion: &q}, nil
}

// StartOrResumeDiagnostic returns attempt id and first (or resumed) question.
func StartOrResumeDiagnostic(ctx context.Context, pool *pgxpool.Pool, courseID, enrollmentID, userID uuid.UUID) (uuid.UUID, coursemodulequiz.AdaptiveQuizGeneratedQuestion, error) {
	diagnostic, err := diagrepo.GetDiagnosticForCourse(ctx, pool, courseID)
	if err != nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
	}
	if diagnostic == nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("diagnostic is not configured for this course")
	}
	en, err := enrollment.GetByID(ctx, pool, enrollmentID)
	if err != nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
	}
	if en == nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("%w", ErrNotFound)
	}
	if en.UserID != userID || en.CourseID != courseID || en.Role != "student" {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("%w", ErrForbidden)
	}
	latest, err := diagrepo.LatestAttemptForEnrollment(ctx, pool, diagnostic.ID, enrollmentID)
	if err != nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
	}
	if latest != nil {
		if latest.CompletedAt != nil {
			switch diagnostic.RetakePolicy {
			case "always":
			default:
				return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("diagnostic was already completed for this enrollment")
			}
		} else {
			var session struct {
				Pending *string `json:"pendingQuestionId"`
			}
			if json.Unmarshal(latest.SessionState, &session) == nil && session.Pending != nil {
				pid, err := uuid.Parse(*session.Pending)
				if err == nil {
					ent, err := questionbank.GetQuestionForCourse(ctx, pool, courseID, pid)
					if err != nil {
						return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
					}
					if ent == nil {
						return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("%w", ErrNotFound)
					}
					q, err := adaptivequizcat.BankEntityToAdaptiveQuestion(ent)
					return latest.ID, q, err
				}
			}
		}
	}
	poolOK, err := questionbank.ListActiveDiagnosticQuestionIDs(ctx, pool, courseID, diagnostic.ConceptIDs)
	if err != nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
	}
	if len(poolOK) == 0 {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("no eligible question-bank items found for this diagnostic (tag concepts or set metadata.conceptIds)")
	}
	used := make(map[uuid.UUID]struct{})
	var history [][3]float64
	counts := make(map[uuid.UUID]int)
	firstID, err := pickNextQuestionID(ctx, pool, courseID, diagnostic, used, history, counts)
	if err != nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
	}
	if firstID == nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("could not select a diagnostic question")
	}
	ent, err := questionbank.GetQuestionForCourse(ctx, pool, courseID, *firstID)
	if err != nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
	}
	if ent == nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("%w", ErrNotFound)
	}
	q, err := adaptivequizcat.BankEntityToAdaptiveQuestion(ent)
	if err != nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
	}
	sess, _ := json.Marshal(map[string]string{"pendingQuestionId": firstID.String()})
	row, err := diagrepo.InsertDiagnosticAttempt(ctx, pool, diagnostic.ID, enrollmentID, sess)
	if err != nil {
		return uuid.Nil, coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, err
	}
	return row.ID, q, nil
}

// BypassDiagnosticForEnrolment marks the latest in-progress attempt bypassed or inserts a bypass row.
func BypassDiagnosticForEnrollment(ctx context.Context, pool *pgxpool.Pool, courseID, enrollmentID, userID uuid.UUID) error {
	diagnostic, err := diagrepo.GetDiagnosticForCourse(ctx, pool, courseID)
	if err != nil {
		return err
	}
	if diagnostic == nil {
		return fmt.Errorf("diagnostic is not configured for this course")
	}
	en, err := enrollment.GetByID(ctx, pool, enrollmentID)
	if err != nil {
		return err
	}
	if en == nil {
		return fmt.Errorf("%w", ErrNotFound)
	}
	if en.UserID != userID || en.CourseID != courseID || en.Role != "student" {
		return fmt.Errorf("%w", ErrForbidden)
	}
	latest, err := diagrepo.LatestAttemptForEnrollment(ctx, pool, diagnostic.ID, enrollmentID)
	if err != nil {
		return err
	}
	if latest != nil && latest.CompletedAt == nil {
		empty, _ := json.Marshal([]any{})
		return diagrepo.BypassAttempt(ctx, pool, latest.ID, empty)
	}
	_, err = diagrepo.InsertBypassedAttempt(ctx, pool, diagnostic.ID, enrollmentID)
	return err
}
