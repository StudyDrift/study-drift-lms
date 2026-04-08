-- Links users to application roles (union of permissions from all assigned roles).

CREATE TABLE user_app_roles (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES app_roles (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_app_roles_role_id ON user_app_roles (role_id);

-- Existing users: assign Student role so everyone has a baseline role.
INSERT INTO user_app_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN app_roles r
WHERE r.name = 'Student';

-- Baseline permission for managing RBAC in settings (adjust role assignments later as needed).
INSERT INTO permissions (permission_string, description)
VALUES (
        'global:app:rbac:manage',
        'Create and edit roles and permissions in Settings.'
    )
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM app_roles r
CROSS JOIN permissions p
WHERE p.permission_string = 'global:app:rbac:manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
