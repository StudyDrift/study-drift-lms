-- Plan 6.7: Office Hours / Appointment Scheduling
-- Creates availability windows (instructor-defined time blocks) and appointment slots
-- (auto-generated 1:1 bookable slots within those windows).
-- Adds office_hours_enabled feature flag to course.courses (default false).

ALTER TABLE course.courses ADD COLUMN IF NOT EXISTS office_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS course.availability_windows (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id         UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  course_id             UUID REFERENCES course.courses(id) ON DELETE CASCADE,
  day_of_week           SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  window_date           DATE,
  start_time            TIME NOT NULL,
  end_time              TIME NOT NULL,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
  location              TEXT,
  is_virtual            BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_window_type CHECK (
    (day_of_week IS NOT NULL AND window_date IS NULL) OR
    (day_of_week IS NULL AND window_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_avail_windows_course ON course.availability_windows(course_id);
CREATE INDEX IF NOT EXISTS idx_avail_windows_instructor ON course.availability_windows(instructor_id);

CREATE TABLE IF NOT EXISTS course.appointment_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id    UUID NOT NULL REFERENCES course.availability_windows(id) ON DELETE CASCADE,
  slot_start   TIMESTAMPTZ NOT NULL,
  slot_end     TIMESTAMPTZ NOT NULL,
  student_id   UUID REFERENCES "user".users(id) ON DELETE SET NULL,
  student_note TEXT,
  meeting_id   UUID REFERENCES course.virtual_meetings(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available','booked','cancelled','completed')),
  booked_at    TIMESTAMPTZ,
  UNIQUE (window_id, slot_start)
);

CREATE INDEX IF NOT EXISTS idx_slots_window ON course.appointment_slots(window_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_slots_student ON course.appointment_slots(student_id);
CREATE INDEX IF NOT EXISTS idx_slots_start ON course.appointment_slots(slot_start)
  WHERE status = 'available';
