-- LTI 1.3: parent LMS registrations (Lextures as Tool / Provider) and external tools (Platform / Consumer).

CREATE TABLE settings.lti_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    client_id TEXT NOT NULL,
    platform_iss TEXT NOT NULL,
    platform_jwks_url TEXT NOT NULL,
    platform_auth_url TEXT NOT NULL,
    platform_token_url TEXT NOT NULL,
    tool_redirect_uris TEXT[] NOT NULL DEFAULT '{}',
    deployment_ids TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform_iss, client_id)
);

CREATE TABLE settings.lti_external_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    client_id TEXT NOT NULL,
    tool_issuer TEXT NOT NULL,
    tool_jwks_url TEXT NOT NULL,
    tool_oidc_auth_url TEXT NOT NULL,
    tool_token_url TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tool_issuer, client_id)
);

CREATE TABLE settings.lti_nonces (
    nonce TEXT NOT NULL PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_lti_nonces_expires_at ON settings.lti_nonces (expires_at);

CREATE TABLE settings.lti_oidc_states (
    state TEXT NOT NULL PRIMARY KEY,
    issuer TEXT NOT NULL,
    client_id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    target_link_uri TEXT NOT NULL,
    login_hint TEXT,
    deployment_id TEXT,
    message_hint TEXT,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_lti_oidc_states_expires_at ON settings.lti_oidc_states (expires_at);

CREATE TABLE "user".lti_platform_accounts (
    platform_iss TEXT NOT NULL,
    platform_user_sub TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform_iss, platform_user_sub)
);

CREATE TABLE course.lti_resource_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    structure_item_id UUID NOT NULL UNIQUE REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    external_tool_id UUID NOT NULL REFERENCES settings.lti_external_tools (id) ON DELETE RESTRICT,
    resource_link_id TEXT NOT NULL DEFAULT '',
    title TEXT,
    custom_params JSONB NOT NULL DEFAULT '{}',
    line_item_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lti_resource_links_course ON course.lti_resource_links (course_id);

ALTER TABLE course.course_structure_items DROP CONSTRAINT IF EXISTS course_structure_items_kind_check;

ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_kind_check
    CHECK (
        kind IN (
            'module',
            'heading',
            'content_page',
            'assignment',
            'quiz',
            'external_link',
            'survey',
            'lti_link'
        )
    );

ALTER TABLE course.course_structure_items DROP CONSTRAINT IF EXISTS course_structure_items_parent_child_kind_check;

ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_parent_child_kind_check
    CHECK (
        parent_id IS NULL
        OR kind IN (
            'heading',
            'content_page',
            'assignment',
            'quiz',
            'external_link',
            'survey',
            'lti_link'
        )
    );
