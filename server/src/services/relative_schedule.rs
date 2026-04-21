//! Enrollment-relative course schedules: ISO 8601 durations and shifting authored timestamps.

use chrono::{DateTime, Duration, Months, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::course::CoursePublic;
use crate::models::course_structure::CourseStructureItemRow;

/// Parsed `PnYnMnWnD` subset (each part optional; order Y M W D).
#[derive(Debug, Clone, Copy, Default)]
pub struct IsoDuration {
    pub years: u32,
    pub months: u32,
    pub weeks: u64,
    pub days: u64,
}

impl IsoDuration {
    pub fn is_empty(self) -> bool {
        self.years == 0 && self.months == 0 && self.weeks == 0 && self.days == 0
    }

    pub fn add_to(self, base: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let mut t = base;
        let total_months = self.years.checked_mul(12)?.checked_add(self.months)?;
        if total_months > 0 {
            t = t.checked_add_months(Months::new(total_months))?;
        }
        if self.weeks > 0 {
            t = t.checked_add_signed(Duration::weeks(self.weeks as i64))?;
        }
        if self.days > 0 {
            t = t.checked_add_signed(Duration::days(self.days as i64))?;
        }
        Some(t)
    }
}

/// Parses a subset of ISO 8601 durations: `P` then optional `nY`, `nM`, `nW`, `nD` in that order.
pub fn parse_iso8601_duration(s: &str) -> Result<IsoDuration, &'static str> {
    let t = s.trim();
    if t.is_empty() {
        return Err("Duration is empty.");
    }
    let t = t.to_ascii_uppercase();
    let Some(rest) = t.strip_prefix('P') else {
        return Err("Duration must start with P (ISO 8601).");
    };
    if rest.is_empty() {
        return Err("Duration has no components.");
    }
    let mut d = IsoDuration::default();
    let mut r = rest;
    d.years = take_u32_component(&mut r, 'Y')?;
    d.months = take_u32_component(&mut r, 'M')?;
    d.weeks = take_u64_component(&mut r, 'W')?;
    d.days = take_u64_component(&mut r, 'D')?;
    if !r.is_empty() {
        return Err("Unsupported duration format (use PnYnMnWnD only).");
    }
    if d.is_empty() {
        return Err("Duration must include at least one component.");
    }
    Ok(d)
}

fn take_u32_component(rest: &mut &str, unit: char) -> Result<u32, &'static str> {
    let (n, next) = take_component(rest, unit)?;
    *rest = next;
    u32::try_from(n).map_err(|_| "Duration value is too large.")
}

fn take_u64_component(rest: &mut &str, unit: char) -> Result<u64, &'static str> {
    let (n, next) = take_component(rest, unit)?;
    *rest = next;
    Ok(n)
}

fn take_component(rest: &str, unit: char) -> Result<(u64, &str), &'static str> {
    if rest.is_empty() {
        return Ok((0, rest));
    }
    let bytes = rest.as_bytes();
    if !bytes[0].is_ascii_digit() {
        return Ok((0, rest));
    }
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    let num_str = &rest[..i];
    let n: u64 = num_str.parse().map_err(|_| "Invalid number in duration.")?;
    let after_num = &rest[i..];
    let Some(stripped) = after_num.strip_prefix(unit) else {
        return Err("Invalid duration component.");
    };
    Ok((n, stripped))
}

#[derive(Debug, Clone, Copy)]
pub struct RelativeShiftContext {
    pub enrollment_start: DateTime<Utc>,
    pub anchor: DateTime<Utc>,
}

pub fn shift_opt(
    ctx: &RelativeShiftContext,
    stored: Option<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    let t = stored?;
    let delta = t.signed_duration_since(ctx.anchor);
    Some(ctx.enrollment_start + delta)
}

pub fn shift_structure_item_rows(
    rows: Vec<CourseStructureItemRow>,
    ctx: &RelativeShiftContext,
) -> Vec<CourseStructureItemRow> {
    rows.into_iter()
        .map(|mut r| {
            r.visible_from = shift_opt(ctx, r.visible_from);
            r.due_at = shift_opt(ctx, r.due_at);
            r
        })
        .collect()
}

/// Course-level timestamps as experienced by a learner in relative mode.
pub fn materialize_course_for_student(
    mut course: CoursePublic,
    enrollment_start: DateTime<Utc>,
) -> CoursePublic {
    course.starts_at = Some(enrollment_start);
    course.visible_from = Some(enrollment_start);
    course.ends_at = course
        .relative_end_after
        .as_deref()
        .and_then(|s| parse_iso8601_duration(s).ok())
        .and_then(|d| d.add_to(enrollment_start));
    course.hidden_at = course
        .relative_hidden_after
        .as_deref()
        .and_then(|s| parse_iso8601_duration(s).ok())
        .and_then(|d| d.add_to(enrollment_start));
    course.relative_end_after = None;
    course.relative_hidden_after = None;
    course.relative_schedule_anchor_at = None;
    course
}

pub async fn load_shift_context_for_user(
    pool: &PgPool,
    course: &CoursePublic,
    user_id: Uuid,
) -> Result<Option<RelativeShiftContext>, sqlx::Error> {
    if course.schedule_mode != "relative" {
        return Ok(None);
    }
    let Some(anchor) = course.relative_schedule_anchor_at else {
        return Ok(None);
    };
    let Some(enrollment_start) =
        crate::repos::enrollment::student_enrollment_started_at(pool, course.id, user_id).await?
    else {
        return Ok(None);
    };
    Ok(Some(RelativeShiftContext {
        enrollment_start,
        anchor,
    }))
}
