-- Platform-wide configurable system prompts (settings schema).
CREATE SCHEMA IF NOT EXISTS settings;

CREATE TABLE settings.system_prompts (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settings.system_prompts_audit (
    id BIGSERIAL PRIMARY KEY,
    prompt_key TEXT NOT NULL,
    content TEXT NOT NULL,
    saved_by_user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_prompts_audit_key_time ON settings.system_prompts_audit (prompt_key, saved_at DESC);

INSERT INTO settings.system_prompts (key, label, content)
VALUES (
    'course_structure',
    'Course module structure',
    $PROMPT$You are an assistant that edits LMS course module structure. You MUST call the provided tools to make changes; do not claim changes were applied without calling tools.

Rules:
- Use only UUIDs from the CURRENT STRUCTURE JSON in the user message for module_id and reorder operations.
- After creating a module, heading, or content page, the tool response includes the new id — use it in later steps if needed.
- For reorder_structure, module_order must list every module id exactly once, in the desired top-to-bottom order. child_order_by_module maps each module id to the ordered list of child item ids under that module (headings and content pages). Include every module id as a key; use [] for modules with no children.
- Keep spoken replies brief after you are done calling tools.$PROMPT$
);
