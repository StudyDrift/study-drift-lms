-- Plan 3.7: standards-based grading (SBG) — per-course standards, alignments, cached proficiencies.

CREATE TABLE course.course_standards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    external_id TEXT,
    description TEXT NOT NULL,
    subject TEXT,
    grade_level TEXT,
    "position" INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_course_standards_course ON course.course_standards (course_id, "position");

CREATE TABLE course.standard_sbg_alignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    standard_id UUID NOT NULL REFERENCES course.course_standards (id) ON DELETE CASCADE,
    structure_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    alignable_type TEXT NOT NULL CHECK (alignable_type IN ('rubric_criterion', 'quiz_question')),
    alignable_id UUID NOT NULL,
    weight NUMERIC(4, 2) NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (standard_id, structure_item_id, alignable_type, alignable_id)
);

CREATE INDEX idx_sbg_align_course ON course.standard_sbg_alignments (course_id);
CREATE INDEX idx_sbg_align_standard ON course.standard_sbg_alignments (standard_id);

CREATE TABLE course.student_standard_proficiencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    standard_id UUID NOT NULL REFERENCES course.course_standards (id) ON DELETE CASCADE,
    proficiency NUMERIC(5, 2),
    level_label TEXT,
    last_assessed TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course_id, student_id, standard_id)
);

CREATE INDEX idx_ssp_course ON course.student_standard_proficiencies (course_id);
CREATE INDEX idx_ssp_student ON course.student_standard_proficiencies (course_id, student_id);

ALTER TABLE course.courses
    ADD COLUMN sbg_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN sbg_proficiency_scale_json JSONB,
    ADD COLUMN sbg_aggregation_rule TEXT NOT NULL DEFAULT 'most_recent' CHECK (
        sbg_aggregation_rule IN (
            'most_recent',
            'highest',
            'mean',
            'decaying_average'
        )
    );

COMMENT ON TABLE course.course_standards IS
    'Academic standards attached to a course (CSV import or manual); used for SBG proficiency.';
COMMENT ON TABLE course.standard_sbg_alignments IS
    'Links rubric criteria or quiz questions to course standards for SBG rollups.';
COMMENT ON TABLE course.student_standard_proficiencies IS
    'Cached per-student proficiency per standard; recomputed when grades change.';
COMMENT ON COLUMN course.courses.sbg_proficiency_scale_json IS
    'JSON: { "levels": [ { "level": 4, "label": "Exceeds", "minScore": 3.5 }, ... ] } for mapping numeric proficiency to labels.';
