//! Auto-submit expired timed quiz attempts.

use anyhow::Context;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::repos::course;
use crate::repos::course_module_quizzes;
use crate::repos::quiz_attempts;
use crate::services::learner_state;
use crate::services::question_bank;

pub async fn sweep_expired_attempts(
    pool: &PgPool,
    now: DateTime<Utc>,
    limit: i64,
) -> anyhow::Result<usize> {
    let ids = quiz_attempts::list_expired_in_progress_attempt_ids(pool, now, limit)
        .await
        .context("list expired quiz attempts")?;
    let mut auto_submitted = 0usize;
    for id in ids {
        let Some(att) = quiz_attempts::get_attempt(pool, id)
            .await
            .context("get quiz attempt")?
        else {
            continue;
        };

        let mut tx = pool.begin().await.context("begin transaction")?;
        let (earned, possible) =
            quiz_attempts::sum_response_points_for_attempt(&mut *tx, id).await?;
        if !att.is_adaptive {
            if let Some(course_row) = course::get_by_id(pool, att.course_id)
                .await
                .context("course by id")?
            {
                if let Some(quiz_row) = course_module_quizzes::get_for_course_item(
                    pool,
                    att.course_id,
                    att.structure_item_id,
                )
                .await
                .context("module quiz")?
                {
                    let resolved = question_bank::resolve_delivery_questions(
                        pool,
                        att.course_id,
                        att.structure_item_id,
                        course_row.question_bank_enabled,
                        &quiz_row.questions_json.0,
                        Some(att.id),
                        Some(att.student_user_id),
                        false,
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!(e))?;
                    let responses = quiz_attempts::list_responses(pool, id)
                        .await
                        .context("list responses")?;
                    learner_state::apply_mastery_from_saved_responses(
                        pool,
                        &mut *tx,
                        att.course_id,
                        att.student_user_id,
                        id,
                        &resolved.questions,
                        &responses,
                        course_row.hint_scaffolding_enabled,
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!(e))?;
                }
            }
        }

        let score = if possible > 0.0 {
            ((earned / possible) * 100.0).clamp(0.0, 100.0) as f32
        } else {
            0.0
        };
        let ok = quiz_attempts::finalize_attempt_auto_submitted(&mut *tx, id, now, earned, possible, score)
            .await
            .context("finalize attempt")?;
        tx.commit().await.context("commit")?;
        if ok {
            auto_submitted += 1;
            tracing::info!(attempt_id = %id, "quiz attempt auto-submitted after deadline");
        }
    }
    Ok(auto_submitted)
}
