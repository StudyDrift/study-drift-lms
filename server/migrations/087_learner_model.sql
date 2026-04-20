-- Learner model: concepts (stub for 1.2 skill graph), per-learner mastery, audit events.

CREATE TABLE course.concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    difficulty_tier TEXT NOT NULL DEFAULT 'standard'
        CHECK (difficulty_tier IN ('foundational', 'standard', 'advanced')),
    decay_lambda NUMERIC(8, 6) NOT NULL DEFAULT 0.02,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course_id, slug)
);

CREATE INDEX idx_concepts_course ON course.concepts (course_id);

CREATE TABLE course.learner_concept_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES course.concepts (id) ON DELETE CASCADE,
    mastery NUMERIC(5, 4) NOT NULL DEFAULT 0.0 CHECK (
        mastery >= 0
        AND mastery <= 1
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ,
    needs_review_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, concept_id)
);

CREATE INDEX idx_lcs_user ON course.learner_concept_states (user_id);
CREATE INDEX idx_lcs_concept ON course.learner_concept_states (concept_id);
CREATE INDEX idx_lcs_needs_review ON course.learner_concept_states (needs_review_at)
WHERE
    needs_review_at IS NOT NULL;

CREATE TABLE course.learner_concept_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES course.concepts (id) ON DELETE CASCADE,
    attempt_id UUID REFERENCES course.quiz_attempts (id) ON DELETE SET NULL,
    delta NUMERIC(5, 4) NOT NULL,
    mastery_after NUMERIC(5, 4) NOT NULL,
    source TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lce_user_concept ON course.learner_concept_events (user_id, concept_id);

COMMENT ON TABLE course.learner_concept_states IS
'Per-learner mastery estimates keyed to course concepts.';
COMMENT ON TABLE course.learner_concept_events IS
'Append-only mastery update log (quiz_grade, manual, decay).';
