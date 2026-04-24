-- 1.3 Standards alignment: frameworks, hierarchical codes, alignments, course toggle.

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS standards_alignment_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE course.standard_frameworks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    publisher TEXT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (code, version)
);

CREATE TABLE course.standard_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    framework_id UUID NOT NULL REFERENCES course.standard_frameworks (id) ON DELETE RESTRICT,
    parent_id UUID REFERENCES course.standard_codes (id) ON DELETE SET NULL,
    code TEXT NOT NULL,
    short_code TEXT,
    description TEXT NOT NULL,
    grade_band TEXT,
    depth_level SMALLINT NOT NULL DEFAULT 1 CHECK (
        depth_level >= 1
        AND depth_level <= 6
    ),
    archived_at TIMESTAMPTZ,
    superseded_by_standard_code_id UUID REFERENCES course.standard_codes (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (framework_id, code)
);

CREATE INDEX idx_sc_framework ON course.standard_codes (framework_id);
CREATE INDEX idx_sc_framework_grade ON course.standard_codes (framework_id, grade_band);
CREATE INDEX idx_sc_fts ON course.standard_codes USING gin (
    to_tsvector('english', code || ' ' || COALESCE(description, ''))
);

CREATE TABLE course.concept_standard_alignments (
    concept_id UUID NOT NULL REFERENCES course.concepts (id) ON DELETE CASCADE,
    standard_code_id UUID NOT NULL REFERENCES course.standard_codes (id) ON DELETE RESTRICT,
    alignment_type TEXT NOT NULL DEFAULT 'primary',
    created_by UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (concept_id, standard_code_id),
    CHECK (alignment_type IN ('primary', 'supplementary'))
);

CREATE INDEX idx_csa_standard ON course.concept_standard_alignments (standard_code_id);

CREATE TABLE course.question_standard_alignments (
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    standard_code_id UUID NOT NULL REFERENCES course.standard_codes (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (question_id, standard_code_id)
);

CREATE INDEX idx_qsa_standard ON course.question_standard_alignments (standard_code_id);

COMMENT ON TABLE course.standard_frameworks IS 'External academic standards frameworks (CCSS, NGSS, state); versioned by (code, version).';
COMMENT ON TABLE course.standard_codes IS 'Hierarchical standard statements; parent_id encodes domain/cluster/standard tree.';
COMMENT ON TABLE course.concept_standard_alignments IS 'Many-to-many links from course or global concepts to standard codes.';
COMMENT ON TABLE course.question_standard_alignments IS 'Direct question-to-standard tags (optional path alongside concept alignments).';

-- Minimal CCSS Mathematics Grade 6 seed (subset for dev/tests; full sets via admin CASE import).
DO $$
DECLARE
    fw_id UUID;
    g6_id UUID;
    ee_id UUID;
    ee_a_id UUID;
    rp_id UUID;
    rp_a_id UUID;
BEGIN
    SELECT id INTO fw_id
    FROM course.standard_frameworks
    WHERE
        code = 'ccss-math'
        AND version = '2010';

    IF fw_id IS NULL THEN
        INSERT INTO course.standard_frameworks (code, name, version, publisher)
        VALUES (
                'ccss-math',
                'Common Core State Standards — Mathematics',
                '2010',
                'NGA Center / CCSSO'
            )
        RETURNING
            id INTO fw_id;
    END IF;

    INSERT INTO course.standard_codes (
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level
        )
    VALUES (
            fw_id,
            NULL,
            'CCSS.MATH.CONTENT.6',
            'Grade 6',
            'Grade 6 mathematics expectations',
            '6',
            1
        )
    ON CONFLICT (framework_id, code) DO NOTHING;

    SELECT id INTO g6_id
    FROM course.standard_codes
    WHERE
        framework_id = fw_id
        AND code = 'CCSS.MATH.CONTENT.6';

    INSERT INTO course.standard_codes (
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level
        )
    VALUES (
            fw_id,
            g6_id,
            'CCSS.MATH.CONTENT.6.EE',
            '6.EE',
            'Expressions and Equations',
            '6',
            2
        )
    ON CONFLICT (framework_id, code) DO NOTHING;

    SELECT id INTO ee_id
    FROM course.standard_codes
    WHERE
        framework_id = fw_id
        AND code = 'CCSS.MATH.CONTENT.6.EE';

    INSERT INTO course.standard_codes (
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level
        )
    VALUES (
            fw_id,
            ee_id,
            'CCSS.MATH.CONTENT.6.EE.A',
            '6.EE.A',
            'Apply and extend previous understandings of arithmetic to algebraic expressions.',
            '6',
            3
        )
    ON CONFLICT (framework_id, code) DO NOTHING;

    SELECT id INTO ee_a_id
    FROM course.standard_codes
    WHERE
        framework_id = fw_id
        AND code = 'CCSS.MATH.CONTENT.6.EE.A';

    INSERT INTO course.standard_codes (
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level
        )
    VALUES
        (
            fw_id,
            ee_a_id,
            'CCSS.MATH.CONTENT.6.EE.A.1',
            '6.EE.A.1',
            'Write and evaluate numerical expressions involving whole-number exponents.',
            '6',
            4
        ),
        (
            fw_id,
            ee_a_id,
            'CCSS.MATH.CONTENT.6.EE.A.2',
            '6.EE.A.2',
            'Write, read, and evaluate expressions in which letters stand for numbers.',
            '6',
            4
        )
    ON CONFLICT (framework_id, code) DO NOTHING;

    INSERT INTO course.standard_codes (
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level
        )
    VALUES (
            fw_id,
            g6_id,
            'CCSS.MATH.CONTENT.6.RP',
            '6.RP',
            'Understand ratio concepts and use ratio reasoning to solve problems.',
            '6',
            2
        )
    ON CONFLICT (framework_id, code) DO NOTHING;

    SELECT id INTO rp_id
    FROM course.standard_codes
    WHERE
        framework_id = fw_id
        AND code = 'CCSS.MATH.CONTENT.6.RP';

    INSERT INTO course.standard_codes (
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level
        )
    VALUES (
            fw_id,
            rp_id,
            'CCSS.MATH.CONTENT.6.RP.A',
            '6.RP.A',
            'Understand ratio concepts and use ratio reasoning to solve problems.',
            '6',
            3
        )
    ON CONFLICT (framework_id, code) DO NOTHING;

    SELECT id INTO rp_a_id
    FROM course.standard_codes
    WHERE
        framework_id = fw_id
        AND code = 'CCSS.MATH.CONTENT.6.RP.A';

    INSERT INTO course.standard_codes (
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level
        )
    VALUES
        (
            fw_id,
            rp_a_id,
            'CCSS.MATH.CONTENT.6.RP.A.1',
            '6.RP.A.1',
            'Understand the concept of a ratio and use ratio language to describe a ratio relationship between two quantities.',
            '6',
            4
        ),
        (
            fw_id,
            rp_a_id,
            'CCSS.MATH.CONTENT.6.RP.A.2',
            '6.RP.A.2',
            'Understand the concept of a unit rate a/b associated with a ratio a:b with b ≠ 0.',
            '6',
            4
        ),
        (
            fw_id,
            rp_a_id,
            'CCSS.MATH.CONTENT.6.RP.A.3',
            '6.RP.A.3',
            'Use ratio and rate reasoning to solve real-world and mathematical problems.',
            '6',
            4
        )
    ON CONFLICT (framework_id, code) DO NOTHING;
END
$$;
