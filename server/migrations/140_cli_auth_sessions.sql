-- CLI browser-based auth flow: pending sessions that the web app approves.
CREATE TABLE "user".cli_auth_sessions (
    token_hash  bytea        PRIMARY KEY,
    access_token  text,
    refresh_token text,
    expires_in    int,
    expires_at    timestamptz NOT NULL,
    approved_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT NOW()
);
