CREATE TABLE user_ai_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    image_model_id TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash-image',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE courses ADD COLUMN hero_image_url TEXT;
