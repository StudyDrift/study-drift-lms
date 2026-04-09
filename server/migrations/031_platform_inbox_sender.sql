-- Dedicated user for automated inbox messages (welcome, etc.). Not intended for login.
INSERT INTO "user".users (id, email, password_hash, display_name)
VALUES (
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'platform@lextures.internal',
    'no-login',
    'Lextures'
)
ON CONFLICT (id) DO NOTHING;
