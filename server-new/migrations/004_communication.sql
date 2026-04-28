-- Mail-like messaging under schema "communication", scoped per user via mailbox_entries.

CREATE SCHEMA IF NOT EXISTS communication;

CREATE TABLE communication.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recipient_user_id UUID REFERENCES users (id) ON DELETE CASCADE,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    has_attachment BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE communication.mailbox_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES communication.messages (id) ON DELETE CASCADE,
    folder TEXT NOT NULL CHECK (folder IN ('inbox', 'sent', 'drafts', 'trash')),
    read_at TIMESTAMPTZ,
    starred BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, message_id)
);

CREATE INDEX idx_mailbox_user_folder ON communication.mailbox_entries (user_id, folder);
CREATE INDEX idx_mailbox_user_starred ON communication.mailbox_entries (user_id, starred)
    WHERE folder <> 'trash';

CREATE INDEX idx_messages_created ON communication.messages (created_at DESC);
