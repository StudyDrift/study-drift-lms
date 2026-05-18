CREATE TABLE onboarding_events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 'k-12' | 'higher-ed' | 'self-learner'
    program       TEXT        NOT NULL CHECK (program IN ('k-12', 'higher-ed', 'self-learner')),
    school_name   TEXT,
    ip_address    TEXT,
    country       TEXT,
    user_agent    TEXT,
    referrer      TEXT,
    language      TEXT,
    timezone      TEXT,
    screen_width  INTEGER,
    screen_height INTEGER
);

-- Reporting queries: filter by date range and program
CREATE INDEX onboarding_events_created_at_idx ON onboarding_events (created_at DESC);
CREATE INDEX onboarding_events_program_idx    ON onboarding_events (program);
