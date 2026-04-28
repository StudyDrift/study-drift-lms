-- Per-student accommodation profiles (504 / IEP / ADA operational settings only; no disability documentation).

INSERT INTO "user".permissions (permission_string, description)
VALUES (
        'global:user:accommodations:manage',
        'Create, read, update, and delete student accommodation records (accessibility coordinators and platform admins).'
    )
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO "user".app_roles (name, description, scope)
VALUES (
        'Accessibility Coordinator',
        'Manages student accommodation records; does not grant course teaching permissions.',
        'global'
    )
ON CONFLICT (name) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id,
       p.id
FROM "user".app_roles r
JOIN "user".permissions p ON p.permission_string = 'global:user:accommodations:manage'
WHERE r.name = 'Accessibility Coordinator'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id,
       p.id
FROM "user".app_roles r
JOIN "user".permissions p ON p.permission_string = 'global:user:accommodations:manage'
WHERE r.name = 'Global Admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE course.student_accommodations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    course_id UUID REFERENCES course.courses (id) ON DELETE CASCADE,
    time_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.0 CHECK (time_multiplier >= 1.0),
    extra_attempts INTEGER NOT NULL DEFAULT 0 CHECK (extra_attempts >= 0),
    hints_always_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reduced_distraction_mode BOOLEAN NOT NULL DEFAULT FALSE,
    alternative_format TEXT,
    effective_from DATE,
    effective_until DATE,
    created_by UUID NOT NULL REFERENCES "user".users (id),
    updated_by UUID REFERENCES "user".users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT student_accommodations_effective_range_chk CHECK (
        effective_from IS NULL
        OR effective_until IS NULL
        OR effective_from <= effective_until
    )
);

CREATE UNIQUE INDEX uq_student_accommodations_user_global ON course.student_accommodations (user_id)
WHERE
    course_id IS NULL;

CREATE UNIQUE INDEX uq_student_accommodations_user_course ON course.student_accommodations (user_id, course_id)
WHERE
    course_id IS NOT NULL;

CREATE INDEX idx_student_accommodations_user_course ON course.student_accommodations (user_id, course_id);

COMMENT ON TABLE course.student_accommodations IS
    'Operational accommodation settings per learner; course_id NULL means all courses. Course-scoped row replaces global for that course.';

COMMENT ON COLUMN course.student_accommodations.alternative_format IS
    'Accessibility-office notes only; FERPA-sensitive — restrict via API to coordinators and the student summary.';

ALTER TABLE course.quiz_attempts
    ADD COLUMN deadline_at TIMESTAMPTZ,
    ADD COLUMN extended_time_applied BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN course.quiz_attempts.deadline_at IS
    'When set, the learner must finish before this instant (already reflects accommodation multipliers).';

COMMENT ON COLUMN course.quiz_attempts.extended_time_applied IS
    'True when extended time from an accommodation profile was applied to deadline_at.';
