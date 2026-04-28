-- Course feed (channel-based chat: messages, replies, likes, pins, mentions).

CREATE TABLE course.feed_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_by_user_id UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feed_channels_course_sort ON course.feed_channels (course_id, sort_order, created_at);

CREATE TABLE course.feed_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES course.feed_channels (id) ON DELETE CASCADE,
    author_user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    parent_message_id UUID REFERENCES course.feed_messages (id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    mentions_everyone BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_at TIMESTAMPTZ,
    pinned_by_user_id UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,
    CONSTRAINT feed_messages_body_len CHECK (char_length(body) <= 8000)
);

CREATE INDEX idx_feed_messages_channel_created ON course.feed_messages (channel_id, created_at DESC);
CREATE INDEX idx_feed_messages_parent ON course.feed_messages (parent_message_id);

CREATE TABLE course.feed_message_likes (
    message_id UUID NOT NULL REFERENCES course.feed_messages (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

CREATE TABLE course.feed_message_mentions (
    message_id UUID NOT NULL REFERENCES course.feed_messages (id) ON DELETE CASCADE,
    mentioned_user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, mentioned_user_id)
);
