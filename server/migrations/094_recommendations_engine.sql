-- 1.8 Recommendations: instructor overrides, per-learner cache, event log.

CREATE TABLE course.course_recommendation_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    structure_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    override_type TEXT NOT NULL CHECK (override_type IN ('pin', 'suppress')),
    surface TEXT,
    created_by UUID NOT NULL REFERENCES "user".users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_course_rec_overrides_course ON course.course_recommendation_overrides (course_id);

CREATE TABLE course.recommendation_cache (
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    surface TEXT NOT NULL,
    recommendations JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, course_id, surface)
);

CREATE INDEX idx_recommendation_cache_expires ON course.recommendation_cache (expires_at);

CREATE TABLE course.recommendation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    item_id UUID,
    surface TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'click', 'dismiss')),
    rank SMALLINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recommendation_events_user_time ON course.recommendation_events (user_id, created_at DESC);
CREATE INDEX idx_recommendation_events_course_time ON course.recommendation_events (course_id, created_at DESC);
