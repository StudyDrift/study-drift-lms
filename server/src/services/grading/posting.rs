//! Grade post / hold and scheduled release (plan 3.8).

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::repos::course_grades;
use crate::repos::course_module_assignments;
use crate::repos::grade_audit_events;
use crate::repos::moderated_grading as moderated_grading_repo;

/// Runs `release_at` deadlines: posts held grades and clears the schedule. Idempotent.
pub async fn sweep_scheduled_releases(
    pool: &PgPool,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let due = course_module_assignments::list_structures_with_past_due_release(pool, now).await?;
    for (course_id, item_id) in due {
        if let Err(e) = mark_posted_instructor(
            pool,
            course_id,
            item_id,
            now,
            None,
            Uuid::nil(), // no actor: audit uses payload-only
            true,
        )
        .await
        {
            tracing::warn!(%course_id, %item_id, err = %e, "grade_posting.scheduled_release_skipped");
        }
    }
    Ok(())
}

/// Posts held grades. When `bypass_moderation_check` (e.g. sweep), 3.4 gating is skipped.
pub async fn mark_posted_instructor(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    at: DateTime<Utc>,
    only_students: Option<&[Uuid]>,
    actor_user_id: Uuid,
    bypass_moderation_check: bool,
) -> Result<usize, PostingError> {
    let Some(asn) = course_module_assignments::get_for_course_item(pool, course_id, module_item_id)
        .await
        .map_err(PostingError::from)?
    else {
        return Err(PostingError::NotFound);
    };
    if !bypass_moderation_check && asn.moderated_grading {
        let n_flagged = moderated_grading_repo::count_flagged_unreconciled(
            pool,
            course_id,
            module_item_id,
            asn.points_worth.unwrap_or(100).max(1),
            asn.moderation_threshold_pct,
        )
        .await
        .map_err(PostingError::from)?;
        if n_flagged > 0 {
            return Err(PostingError::ModerationPending(n_flagged));
        }
    }
    let mut tx = pool.begin().await.map_err(PostingError::from)?;
    let posted = course_grades::mark_posted(
        &mut *tx,
        course_id,
        module_item_id,
        at,
        only_students,
    )
    .await
    .map_err(PostingError::from)?;
    for (sid, pts) in &posted {
        let actor = if actor_user_id == Uuid::nil() {
            None
        } else {
            Some(actor_user_id)
        };
        let reason = if actor.is_none() {
            Some("Scheduled or system release of held grades (3.8).")
        } else {
            None
        };
        grade_audit_events::insert(
            &mut *tx,
            course_id,
            module_item_id,
            *sid,
            actor,
            "posted",
            Some(*pts),
            Some(*pts),
            Some("unposted"),
            Some("posted"),
            reason,
        )
        .await
        .map_err(PostingError::from)?;
    }
    tx.commit().await.map_err(PostingError::from)?;
    if only_students.is_none() {
        let _ = course_module_assignments::clear_release_at(pool, course_id, module_item_id).await;
    }
    tracing::info!(
        target: "grade_post",
        %course_id,
        %module_item_id,
        n = posted.len(),
        "grade_posting_completed"
    );
    Ok(posted.len())
}

pub async fn mark_unposted_instructor(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    only_students: Option<&[Uuid]>,
    actor_user_id: Uuid,
) -> Result<usize, PostingError> {
    let mut tx = pool.begin().await.map_err(PostingError::from)?;
    let u = course_grades::mark_unposted(
        &mut *tx,
        course_id,
        module_item_id,
        only_students,
    )
    .await
    .map_err(PostingError::from)?;
    for (sid, pts) in &u {
        grade_audit_events::insert(
            &mut *tx,
            course_id,
            module_item_id,
            *sid,
            Some(actor_user_id),
            "retracted",
            Some(*pts),
            Some(*pts),
            Some("posted"),
            Some("unposted"),
            None,
        )
        .await
        .map_err(PostingError::from)?;
    }
    tx.commit().await.map_err(PostingError::from)?;
    Ok(u.len())
}

#[derive(Debug, Error)]
pub enum PostingError {
    #[error("not found")]
    NotFound,
    #[error("{0} submission(s) still need reconciliation.")]
    ModerationPending(i64),
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
}

impl From<PostingError> for crate::error::AppError {
    fn from(e: PostingError) -> Self {
        match e {
            PostingError::NotFound => Self::NotFound,
            PostingError::ModerationPending(n) => Self::UnprocessableEntity {
                message: format!("{n} submission(s) still need reconciliation."),
            },
            PostingError::Sql(x) => Self::from(x),
        }
    }
}
