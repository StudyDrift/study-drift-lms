-- Default OpenRouter model IDs for new user_ai_settings rows and column defaults.
ALTER TABLE "user".user_ai_settings
    ALTER COLUMN image_model_id SET DEFAULT 'black-forest-labs/flux.2-flex',
    ALTER COLUMN course_setup_model_id SET DEFAULT 'arcee-ai/trinity-mini:free';
