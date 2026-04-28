-- Application-wide permission definitions and configurable roles.
-- Permission strings: scope:area:function:action (wildcards allowed, e.g. course:*:enrollments:*).

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permission_string TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rbac_role_permissions (
    role_id UUID NOT NULL REFERENCES app_roles (id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_rbac_role_permissions_permission_id ON rbac_role_permissions (permission_id);

INSERT INTO app_roles (name)
VALUES ('Student'),
       ('Teacher'),
       ('TA');
