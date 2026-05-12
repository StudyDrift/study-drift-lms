-- Plan 5.10 — Parent / guardian accounts and parent–student links (FERPA-oriented read access).

CREATE TABLE "user".parent_student_links (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES tenant.organizations (id) ON DELETE CASCADE,
    parent_user_id    UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    student_user_id   UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    relationship      TEXT NOT NULL DEFAULT 'parent'
        CHECK (relationship IN ('parent', 'guardian', 'other')),
    status              TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'pending', 'revoked')),
    linked_by           UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (parent_user_id, student_user_id)
);

CREATE INDEX idx_parent_student_links_parent ON "user".parent_student_links (parent_user_id);
CREATE INDEX idx_parent_student_links_student ON "user".parent_student_links (student_user_id);
CREATE INDEX idx_parent_student_links_org ON "user".parent_student_links (org_id);

COMMENT ON TABLE "user".parent_student_links IS 'K-12 parent/guardian linkage to student accounts (plan 5.10).';

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'standard'
        CHECK (account_type IN ('standard', 'parent'));
