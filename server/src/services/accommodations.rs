//! Resolve accommodation settings for quiz delivery (plan 2.11).

use crate::error::AppError;
use crate::repos::quiz_attempts::QuizAttemptRow;
use crate::repos::student_accommodations::{self, StudentAccommodationRow};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
pub struct EffectiveAccommodations {
    pub time_multiplier: f64,
    pub extra_attempts: i32,
    pub hints_always_enabled: bool,
    pub reduced_distraction_mode: bool,
}

impl EffectiveAccommodations {
    fn from_row(r: &StudentAccommodationRow) -> Self {
        Self {
            time_multiplier: r.time_multiplier.max(1.0),
            extra_attempts: r.extra_attempts.max(0),
            hints_always_enabled: r.hints_always_enabled,
            reduced_distraction_mode: r.reduced_distraction_mode,
        }
    }

    pub fn has_operational_settings(&self) -> bool {
        self.time_multiplier > 1.000_001
            || self.extra_attempts > 0
            || self.hints_always_enabled
            || self.reduced_distraction_mode
    }
}

pub async fn resolve_effective_for_course(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
) -> Result<EffectiveAccommodations, sqlx::Error> {
    if let Some(r) =
        student_accommodations::find_active_for_course(pool, user_id, course_id).await?
    {
        return Ok(EffectiveAccommodations::from_row(&r));
    }
    if let Some(r) = student_accommodations::find_active_global(pool, user_id).await? {
        return Ok(EffectiveAccommodations::from_row(&r));
    }
    Ok(EffectiveAccommodations::default())
}

/// On lookup failure, log and return defaults so quiz delivery never blocks (FR reliability).
pub async fn resolve_effective_or_default(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
) -> EffectiveAccommodations {
    match resolve_effective_for_course(pool, user_id, course_id).await {
        Ok(v) => v,
        Err(e) => {
            let prefix: String = user_id.to_string().chars().take(8).collect();
            tracing::warn!(
                error = %e,
                user_id_prefix = %prefix,
                "accommodation lookup failed; using defaults"
            );
            EffectiveAccommodations::default()
        }
    }
}

pub fn instructor_flag_labels(eff: &EffectiveAccommodations) -> Vec<String> {
    let mut v = Vec::new();
    if eff.time_multiplier > 1.000_001 {
        v.push("extended_time".to_string());
    }
    if eff.extra_attempts > 0 {
        v.push("extra_attempts".to_string());
    }
    if eff.reduced_distraction_mode {
        v.push("reduced_distraction".to_string());
    }
    if eff.hints_always_enabled {
        v.push("always_allow_hints".to_string());
    }
    v
}

pub fn log_accommodation_applied(user_id: Uuid, quiz_item_id: Uuid, labels: &[String]) {
    let prefix: String = user_id.to_string().chars().take(8).collect();
    tracing::info!(
        user_id_prefix = %prefix,
        quiz_item_id = %quiz_item_id,
        accommodation_types = ?labels,
        "accommodation_applied"
    );
}

pub fn compute_attempt_deadline(
    started_at: DateTime<Utc>,
    time_limit_minutes: Option<i32>,
    time_multiplier: f64,
) -> (Option<DateTime<Utc>>, bool) {
    let Some(mins) = time_limit_minutes.filter(|m| *m > 0) else {
        return (None, false);
    };
    let mult = time_multiplier.max(1.0);
    let base_secs = (mins as f64) * 60.0;
    let adjusted_secs = (base_secs * mult).round().max(1.0) as i64;
    let extended = mult > 1.000_001;
    (
        Some(started_at + chrono::Duration::seconds(adjusted_secs)),
        extended,
    )
}

pub fn effective_max_submitted_attempts(
    quiz_max_attempts: i32,
    unlimited: bool,
    extra: i32,
) -> Option<i64> {
    if unlimited {
        return None;
    }
    Some(quiz_max_attempts as i64 + extra.max(0) as i64)
}

pub fn require_attempt_within_deadline(
    att: &QuizAttemptRow,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    if let Some(dl) = att.deadline_at {
        if now > dl {
            return Err(AppError::AttemptTimeExpired);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadline_multiplies_time() {
        let started = DateTime::parse_from_rfc3339("2026-01-01T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let (dl, ext) = compute_attempt_deadline(started, Some(60), 1.5);
        let dl = dl.unwrap();
        assert!(ext);
        let delta = (dl - started).num_seconds();
        assert_eq!(delta, 60 * 60 * 3 / 2);
    }

    #[test]
    fn effective_max_attempts_adds_grant() {
        assert_eq!(effective_max_submitted_attempts(2, false, 1), Some(3));
        assert_eq!(effective_max_submitted_attempts(2, true, 5), None);
    }
}
