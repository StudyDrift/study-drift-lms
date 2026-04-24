ALTER TABLE user_ai_settings
ADD COLUMN course_setup_model_id TEXT NOT NULL DEFAULT 'google/gemini-2.0-flash-001';
