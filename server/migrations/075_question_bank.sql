-- Question bank, reusable pools, quiz delivery refs, and per-attempt pool samples.

CREATE TYPE course.question_type AS ENUM (
    'mc_single',
    'mc_multiple',
    'true_false',
    'short_answer',
    'numeric',
    'matching',
    'ordering',
    'hotspot',
    'formula',
    'code',
    'file_upload',
    'audio_response',
    'video_response'
);

CREATE TYPE course.question_status AS ENUM ('draft', 'active', 'retired');

CREATE TABLE course.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    question_type course.question_type NOT NULL DEFAULT 'mc_single',
    stem TEXT NOT NULL,
    options JSONB,
    correct_answer JSONB,
    explanation TEXT,
    points NUMERIC(6, 2) NOT NULL DEFAULT 1.0,
    status course.question_status NOT NULL DEFAULT 'draft',
    shared BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL DEFAULT 'authored',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    irt_a NUMERIC(6, 4),
    irt_b NUMERIC(6, 4),
    irt_status TEXT NOT NULL DEFAULT 'uncalibrated',
    created_by UUID REFERENCES "user".users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_q_course ON course.questions (course_id, status);
CREATE INDEX idx_q_stem_fts ON course.questions USING gin (to_tsvector('english', stem));
CREATE INDEX idx_q_type ON course.questions (course_id, question_type);

CREATE TABLE course.question_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qp_course ON course.question_pools (course_id);

CREATE TABLE course.question_pool_members (
    pool_id UUID NOT NULL REFERENCES course.question_pools (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    PRIMARY KEY (pool_id, question_id)
);

CREATE TABLE course.quiz_question_refs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    structure_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    question_id UUID REFERENCES course.questions (id) ON DELETE RESTRICT,
    pool_id UUID REFERENCES course.question_pools (id) ON DELETE RESTRICT,
    sample_n INTEGER,
    position SMALLINT NOT NULL,
    CHECK (
        (question_id IS NOT NULL AND pool_id IS NULL AND sample_n IS NULL)
        OR (question_id IS NULL AND pool_id IS NOT NULL AND sample_n IS NOT NULL AND sample_n >= 1)
    )
);

CREATE INDEX idx_qqr_item ON course.quiz_question_refs (structure_item_id, position);

CREATE TABLE course.attempt_question_selections (
    attempt_id UUID NOT NULL REFERENCES course.quiz_attempts (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    position SMALLINT NOT NULL,
    PRIMARY KEY (attempt_id, question_id),
    UNIQUE (attempt_id, position)
);

CREATE INDEX idx_aqs_attempt ON course.attempt_question_selections (attempt_id);

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS question_bank_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON TABLE course.questions IS 'Normalized assessment items for reuse, pools, and analytics.';
COMMENT ON TABLE course.quiz_question_refs IS 'Ordered delivery spec for a quiz: fixed question rows and/or pool draws.';
COMMENT ON TABLE course.attempt_question_selections IS 'Stable question draw for a quiz attempt (especially pool sampling).';
