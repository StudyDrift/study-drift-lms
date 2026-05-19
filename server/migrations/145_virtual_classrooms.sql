-- 6.4 Virtual Classroom: scheduled meetings and attendance recording.

CREATE TABLE IF NOT EXISTS course.virtual_meetings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id           UUID NOT NULL REFERENCES course.courses(id) ON DELETE CASCADE,
  section_id          UUID REFERENCES course.course_sections(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL CHECK (provider IN ('jitsi','bbb','zoom','meet','lti','custom')),
  title               TEXT NOT NULL,
  scheduled_start     TIMESTAMPTZ,
  scheduled_end       TIMESTAMPTZ,
  join_url            TEXT,
  host_url            TEXT,
  external_meeting_id TEXT,
  status              TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','live','ended','cancelled')),
  created_by          UUID NOT NULL REFERENCES "user".users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_meetings_course_status
  ON course.virtual_meetings(course_id, status);

CREATE INDEX IF NOT EXISTS idx_virtual_meetings_start
  ON course.virtual_meetings(scheduled_start)
  WHERE status IN ('scheduled','live');

CREATE TABLE IF NOT EXISTS course.meeting_attendance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID NOT NULL REFERENCES course.virtual_meetings(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at     TIMESTAMPTZ,
  duration_s  INTEGER,
  UNIQUE (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_attendance_meeting
  ON course.meeting_attendance(meeting_id);
