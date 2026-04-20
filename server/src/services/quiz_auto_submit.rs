//! Auto-submit expired timed quiz attempts.

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::repos::quiz_attempts;

pub async fn sweep_expired_attempts(pool: &PgPool, now: DateTime<Utc>, limit: i64) -> Result<usize, sqlx::Error> {
    let ids = quiz_attempts::list_expired_in_progress_attempt_ids(pool, now, limit).await?;
    let mut auto_submitted = 0usize;
    for id in ids {
        let mut tx = pool.begin().await?;
        let (earned, possible) = quiz_attempts::sum_response_points_for_attempt(&mut *tx, id).await?;
        let score = if possible > 0.0 {
            ((earned / possible) * 100.0).clamp(0.0, 100.0) as f32
        } else {
            0.0
        };
        let ok =
            quiz_attempts::finalize_attempt_auto_submitted(&mut *tx, id, now, earned, possible, score).await?;
        tx.commit().await?;
        if ok {
            auto_submitted += 1;
            tracing::info!(attempt_id = %id, "quiz attempt auto-submitted after deadline");
        }
    }
    Ok(auto_submitted)
}
