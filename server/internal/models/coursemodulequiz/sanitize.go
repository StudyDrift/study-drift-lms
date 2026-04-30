package coursemodulequiz

// SanitizeQuizQuestionsForLearner clears correct-answer metadata (Rust `sanitize_quiz_questions_for_learner`).
func SanitizeQuizQuestionsForLearner(qs []QuizQuestion) []QuizQuestion {
	if len(qs) == 0 {
		return nil
	}
	out := make([]QuizQuestion, len(qs))
	for i := range qs {
		out[i] = qs[i]
		out[i].CorrectChoiceIndex = nil
		if len(qs[i].Choices) > 0 {
			out[i].Choices = append([]string(nil), qs[i].Choices...)
		}
		if len(qs[i].ChoiceIDs) > 0 {
			out[i].ChoiceIDs = append([]string(nil), qs[i].ChoiceIDs...)
		}
		if len(qs[i].ConceptIDs) > 0 {
			out[i].ConceptIDs = append([]string(nil), qs[i].ConceptIDs...)
		}
		if len(qs[i].TypeConfig) > 0 {
			out[i].TypeConfig = append([]byte(nil), qs[i].TypeConfig...)
		}
	}
	return out
}
