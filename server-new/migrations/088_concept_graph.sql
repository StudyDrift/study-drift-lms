-- 1.2 Skill / concept graph: Bloom metadata, prerequisite DAG, question tags, RBAC.

CREATE TYPE course.bloom_level AS ENUM (
    'remember',
    'understand',
    'apply',
    'analyze',
    'evaluate',
    'create'
);

ALTER TABLE course.concepts
    ALTER COLUMN course_id DROP NOT NULL;

ALTER TABLE course.concepts
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS bloom_level course.bloom_level,
    ADD COLUMN IF NOT EXISTS parent_concept_id UUID REFERENCES course.concepts (id) ON DELETE SET NULL;

ALTER TABLE course.concepts
    DROP CONSTRAINT IF EXISTS concepts_course_id_slug_key;

UPDATE course.concepts c
SET
    slug = c.slug || '-' || left(replace(c.id::text, '-', ''), 12)
FROM (
  SELECT id, slug, row_number() OVER (PARTITION BY slug ORDER BY id) AS rn
  FROM course.concepts
) x
WHERE c.id = x.id AND x.rn > 1;

ALTER TABLE course.concepts
    ADD CONSTRAINT concepts_slug_key UNIQUE (slug);

CREATE INDEX IF NOT EXISTS idx_concepts_parent ON course.concepts (parent_concept_id);

CREATE INDEX IF NOT EXISTS idx_concepts_name_fts ON course.concepts USING gin (
    to_tsvector('english', name || ' ' || COALESCE(description, ''))
);

CREATE TABLE course.concept_prerequisites (
    concept_id UUID NOT NULL REFERENCES course.concepts (id) ON DELETE CASCADE,
    prerequisite_id UUID NOT NULL REFERENCES course.concepts (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (concept_id, prerequisite_id),
    CHECK (concept_id <> prerequisite_id)
);

CREATE INDEX idx_cp_prerequisite ON course.concept_prerequisites (prerequisite_id);

CREATE TABLE course.concept_question_tags (
    concept_id UUID NOT NULL REFERENCES course.concepts (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (concept_id, question_id)
);

CREATE INDEX idx_cqt_question ON course.concept_question_tags (question_id);

INSERT INTO "user".permissions (permission_string, description)
VALUES (
        'global:app:concepts:manage',
        'Create and edit the platform concept taxonomy and prerequisite edges.'
    )
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id,
       p.id
FROM "user".app_roles r
JOIN "user".permissions p ON p.permission_string = 'global:app:concepts:manage'
WHERE
    r.name IN ('Teacher', 'TA', 'Global Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Minimal Bloom taxonomy: one parent row + six level nodes (children of `bloom`).
DO $$
DECLARE
    bloom_id UUID;
BEGIN
    SELECT id INTO bloom_id FROM course.concepts WHERE slug = 'bloom' LIMIT 1;
    IF bloom_id IS NULL THEN
        INSERT INTO course.concepts (
            course_id,
            slug,
            name,
            description,
            bloom_level,
            parent_concept_id
        )
        VALUES (
            NULL,
            'bloom',
            'Bloom''s Taxonomy',
            'Bloom''s Revised Taxonomy — cognitive process levels used as top-level groups.',
            NULL,
            NULL
        )
        RETURNING id INTO bloom_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM course.concepts
        WHERE
            parent_concept_id = bloom_id
            AND slug = 'bloom-remember'
    ) THEN
        INSERT INTO course.concepts (
            course_id,
            slug,
            name,
            description,
            bloom_level,
            parent_concept_id
        )
        VALUES
            (
                NULL,
                'bloom-remember',
                'Remember',
                'Retrieving relevant knowledge from long-term memory.',
                'remember'::course.bloom_level,
                bloom_id
            ),
            (
                NULL,
                'bloom-understand',
                'Understand',
                'Determining the meaning of instructional messages.',
                'understand'::course.bloom_level,
                bloom_id
            ),
            (
                NULL,
                'bloom-apply',
                'Apply',
                'Carrying out or using a procedure in a given situation.',
                'apply'::course.bloom_level,
                bloom_id
            ),
            (
                NULL,
                'bloom-analyze',
                'Analyze',
                'Breaking material into parts and detecting relationships.',
                'analyze'::course.bloom_level,
                bloom_id
            ),
            (
                NULL,
                'bloom-evaluate',
                'Evaluate',
                'Making judgments based on criteria and standards.',
                'evaluate'::course.bloom_level,
                bloom_id
            ),
            (
                NULL,
                'bloom-create',
                'Create',
                'Putting elements together to form a novel whole.',
                'create'::course.bloom_level,
                bloom_id
            );
    END IF;
END
$$;
