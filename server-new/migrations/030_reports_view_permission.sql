-- Learning activity reports (user.user_audit aggregates). Grant via Settings → Roles.
INSERT INTO "user".permissions (permission_string, description)
VALUES (
        'global:app:reports:view',
        'View learning activity reports (course visits and content engagement).'
    )
ON CONFLICT (permission_string) DO NOTHING;
