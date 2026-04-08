-- Role metadata for Settings UI: human-readable description and assignment scope.

ALTER TABLE "user".app_roles
    ADD COLUMN description TEXT NOT NULL DEFAULT '',
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'
        CHECK (scope IN ('global', 'course'));

COMMENT ON COLUMN "user".app_roles.scope IS 'global: assignable via Settings → users; course: intended for per-course assignment (informational).';
