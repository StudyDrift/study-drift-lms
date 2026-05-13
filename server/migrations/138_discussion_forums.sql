-- Plan 6.1 — threaded discussion forums (course-scoped).
ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS discussions_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN course.courses.discussions_enabled IS
    'When true, enrolled users can access course discussion forums (plan 6.1).';

CREATE TABLE course.discussion_forums (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id uuid NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    position integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_discussion_forums_course ON course.discussion_forums (course_id, position);

CREATE TABLE course.discussion_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_id uuid NOT NULL REFERENCES course.discussion_forums (id) ON DELETE CASCADE,
    assignment_structure_item_id uuid REFERENCES course.module_assignments (structure_item_id) ON DELETE SET NULL,
    author_id uuid NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    title text NOT NULL,
    body jsonb NOT NULL,
    is_pinned boolean NOT NULL DEFAULT false,
    is_locked boolean NOT NULL DEFAULT false,
    require_post_first boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_discussion_threads_forum ON course.discussion_threads (forum_id, is_pinned DESC, updated_at DESC);

CREATE TABLE course.discussion_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES course.discussion_threads (id) ON DELETE CASCADE,
    parent_post_id uuid REFERENCES course.discussion_posts (id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    body jsonb NOT NULL,
    upvote_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_discussion_posts_thread ON course.discussion_posts (thread_id, created_at, id);

CREATE TABLE course.discussion_post_upvotes (
    post_id uuid NOT NULL REFERENCES course.discussion_posts (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE course.discussion_post_idempotency (
    course_id uuid NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    thread_id uuid NOT NULL REFERENCES course.discussion_threads (id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    post_id uuid NOT NULL REFERENCES course.discussion_posts (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, user_id, thread_id, idempotency_key)
);
