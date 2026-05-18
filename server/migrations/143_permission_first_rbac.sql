-- Plan 5.11 — Permission-First RBAC (Eliminate Hard-Coded Roles)
-- Makes role decisions catalog-driven rather than string-literal-based.

-- 1. Capability bits on the course enrollment-role catalog.
ALTER TABLE course.enrollment_roles
    ADD COLUMN IF NOT EXISTS is_staff              BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_student_equivalent BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_grade             BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_author_content    BOOLEAN NOT NULL DEFAULT false;

-- Ensure 'owner' exists in the catalog (the CHECK constraint already allows it).
INSERT INTO course.enrollment_roles (role_key, display_name, sort_order)
VALUES ('owner', 'Owner', -1)
ON CONFLICT (role_key) DO NOTHING;

UPDATE course.enrollment_roles SET is_staff = true, can_grade = true, can_author_content = true WHERE role_key IN ('owner','teacher','instructor');
UPDATE course.enrollment_roles SET is_staff = true, can_grade = true                            WHERE role_key = 'ta';
UPDATE course.enrollment_roles SET is_staff = true, can_author_content = true                   WHERE role_key = 'designer';
UPDATE course.enrollment_roles SET is_staff = true                                              WHERE role_key IN ('observer','auditor','librarian');
UPDATE course.enrollment_roles SET is_student_equivalent = true                                 WHERE role_key = 'student';

-- 2. Swap the CHECK constraint on course_enrollments to a FK pointing at the catalog.
ALTER TABLE course.course_enrollments
    DROP CONSTRAINT IF EXISTS course_enrollments_role_check;

ALTER TABLE course.course_enrollments
    ADD CONSTRAINT course_enrollments_role_fkey
    FOREIGN KEY (role) REFERENCES course.enrollment_roles(role_key);

-- 3. Capability bits on user.app_roles for the viewAs permission filter.
ALTER TABLE "user".app_roles
    ADD COLUMN IF NOT EXISTS is_staff_app_role   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_student_app_role BOOLEAN NOT NULL DEFAULT false;

UPDATE "user".app_roles SET is_staff_app_role = true   WHERE name IN ('Teacher','TA','Global Admin');
UPDATE "user".app_roles SET is_student_app_role = true WHERE name IN ('Student');

-- 4. Org role keys catalog (mirrors the existing org_role_grants CHECK values).
CREATE TABLE IF NOT EXISTS "user".org_role_keys (
    role_key      TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    is_admin      BOOLEAN NOT NULL DEFAULT false,
    is_viewer     BOOLEAN NOT NULL DEFAULT false,
    sort_order    INTEGER NOT NULL DEFAULT 100
);

INSERT INTO "user".org_role_keys (role_key, display_name, is_admin, is_viewer, sort_order)
VALUES ('org_admin',      'Org Admin',      true,  true,  0),
       ('org_unit_admin', 'Org Unit Admin', true,  true,  10),
       ('org_viewer',     'Org Viewer',     false, true,  20)
ON CONFLICT (role_key) DO NOTHING;

-- Swap the CHECK constraint on org_role_grants to a FK.
ALTER TABLE "user".org_role_grants
    DROP CONSTRAINT IF EXISTS org_role_grants_role_check;

ALTER TABLE "user".org_role_grants
    ADD CONSTRAINT org_role_grants_role_fkey
    FOREIGN KEY (role) REFERENCES "user".org_role_keys(role_key);

-- 5. Provisioning role map: external SSO provider + external_role → app_roles.
CREATE TABLE IF NOT EXISTS "user".provisioning_role_map (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider       TEXT NOT NULL CHECK (provider IN ('saml','oidc','scim','oneroster','clever','classlink')),
    external_role  TEXT NOT NULL,
    app_role_id    UUID NOT NULL REFERENCES "user".app_roles(id) ON DELETE RESTRICT,
    account_type   TEXT NOT NULL DEFAULT 'standard' CHECK (account_type IN ('standard','parent')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expression-based unique index (prevents duplicate provider+role mappings case-insensitively).
CREATE UNIQUE INDEX IF NOT EXISTS idx_provisioning_role_map_lookup
    ON "user".provisioning_role_map (provider, lower(external_role));

-- Seed from current hard-coded behaviour so existing deployments keep the same semantics.
INSERT INTO "user".provisioning_role_map (provider, external_role, app_role_id, account_type)
SELECT 'oneroster', 'teacher',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Teacher'
UNION ALL SELECT 'oneroster', 'student',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Student'
UNION ALL SELECT 'oneroster', 'aide',         r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'TA'
UNION ALL SELECT 'oneroster', 'administrator',r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Global Admin'
UNION ALL SELECT 'oneroster', 'guardian',     r.id, 'parent'   FROM "user".app_roles r WHERE r.name = 'Parent'
UNION ALL SELECT 'clever',    'teacher',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Teacher'
UNION ALL SELECT 'clever',    'staff',        r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Teacher'
UNION ALL SELECT 'clever',    'student',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Student'
UNION ALL SELECT 'clever',    'district_admin',r.id,'standard' FROM "user".app_roles r WHERE r.name = 'Global Admin'
UNION ALL SELECT 'clever',    'administrator',r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Global Admin'
UNION ALL SELECT 'clever',    'admin',        r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Global Admin'
UNION ALL SELECT 'saml',      'teacher',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Teacher'
UNION ALL SELECT 'saml',      'student',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Student'
UNION ALL SELECT 'scim',      'teacher',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Teacher'
UNION ALL SELECT 'scim',      'student',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Student'
UNION ALL SELECT 'oidc',      'teacher',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Teacher'
UNION ALL SELECT 'oidc',      'student',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Student'
UNION ALL SELECT 'classlink', 'teacher',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Teacher'
UNION ALL SELECT 'classlink', 'student',      r.id, 'standard' FROM "user".app_roles r WHERE r.name = 'Student'
ON CONFLICT (provider, lower(external_role)) DO NOTHING;
-- Note: ON CONFLICT uses the expression index defined above.

-- 6. New permission strings covering semantics previously expressed as role-name checks.
INSERT INTO "user".permissions (permission_string, description)
VALUES
  ('course:*:enrollments:role-staff',   'Caller holds a staff-equivalent enrollment in the course.'),
  ('course:*:enrollments:role-student', 'Caller holds a student-equivalent enrollment in the course.'),
  ('course:*:enrollments:assign-staff', 'May assign other users to staff-equivalent course roles.'),
  ('course:*:gradebook:view-own-only',  'Caller may view only their own grades (vs. full gradebook).'),
  ('app:user:account-parent-dashboard', 'Caller should see the parent dashboard and "Family" nav entry.'),
  ('app:user:role-assign-baseline',     'Service-side: provisioning code may attach a baseline role.'),
  ('tenant:org:roles:bootstrap',        'May bootstrap the first Global Admin for a fresh org.')
ON CONFLICT (permission_string) DO NOTHING;

-- 7. Seed permission grants — keep every baseline role's behaviour identical to today.
INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM "user".app_roles r
JOIN "user".permissions p ON true
WHERE
    (r.name = 'Teacher'      AND p.permission_string = 'course:*:enrollments:assign-staff')
 OR (r.name = 'Student'      AND p.permission_string = 'course:*:gradebook:view-own-only')
 OR (r.name = 'Parent'       AND p.permission_string = 'app:user:account-parent-dashboard')
 OR (r.name = 'Global Admin' AND p.permission_string IN ('tenant:org:roles:bootstrap','app:user:role-assign-baseline'))
ON CONFLICT (role_id, permission_id) DO NOTHING;
