-- Adaptive quiz configuration (AI-driven questions from course materials).
ALTER TABLE course.module_quizzes
    ADD COLUMN is_adaptive BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN adaptive_system_prompt TEXT NOT NULL DEFAULT '',
    ADD COLUMN adaptive_source_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN adaptive_question_count INTEGER NOT NULL DEFAULT 5;

COMMENT ON COLUMN course.module_quizzes.is_adaptive IS
    'When true, static questions_json is not used at runtime; questions are generated adaptively via AI.';
COMMENT ON COLUMN course.module_quizzes.adaptive_system_prompt IS
    'Instructor instructions merged into the adaptive quiz AI prompt.';
COMMENT ON COLUMN course.module_quizzes.adaptive_source_item_ids IS
    'JSON array of course_structure_items UUIDs (content pages, assignments, quizzes) whose bodies seed the adaptive model.';
COMMENT ON COLUMN course.module_quizzes.adaptive_question_count IS
    'Maximum number of AI-generated questions per attempt in adaptive mode.';

INSERT INTO settings.system_prompts (key, label, content)
VALUES (
    'adaptive_quiz',
    'Adaptive quiz (single-question steps)',
    $PROMPT$You generate ONE quiz question at a time for an adaptive LMS quiz. Respond with ONLY valid JSON (no markdown fences, no commentary).

The JSON must be a single object with camelCase keys:
- prompt (string, required): the question text shown to the learner.
- questionType (string, required): one of exactly: multiple_choice, true_false
- choices (array of strings): for multiple_choice supply exactly 4 distinct plausible options; for true_false use ["True","False"] in that order.
- choiceWeights (array of numbers): same length as choices; each value is between 0 and 1 meaning how correct that option is (1 = fully correct, 0 = incorrect). Use fine-grained values to represent partial correctness when appropriate.
- multipleAnswer (boolean, default false): keep false unless the prompt truly needs multiple selections.
- answerWithImage (boolean, default false)
- required (boolean, default true)
- points (integer, default 1)
- estimatedMinutes (integer, default 2)

Rules:
- Base every question on the reference course materials provided in the user message.
- For multiple_choice, choiceWeights[i] corresponds to choices[i].
- Calibrate difficulty from the learner history: if they did well, increase depth; if they struggled, reinforce fundamentals.
- When totalQuestionsAllowed is greater than 5, you may occasionally ask a very similar conceptual question to a prior one (rephrased) to help distinguish guessing from understanding; do not copy wording exactly.
- Prefer multiple_choice except when a true/false check is clearly best.
- Never reveal weights or correct answers in the prompt text.$PROMPT$
)
ON CONFLICT (key) DO NOTHING;
