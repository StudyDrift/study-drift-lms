//! Spaced repetition review orchestration (queues, stats, submissions).

use std::env;

use chrono::{Duration, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres};
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course::CoursePublic;
use crate::repos::concepts;
use crate::repos::enrollment;
use crate::repos::learner_model::{self, LearnerSrsMasteryInput};
use crate::repos::srs as srs_repo;
use crate::services::learner_state;
use crate::services::srs_scheduler::{grade_to_quality, sm2_step, Sm2State};

/// Platform kill-switch for SRS (default off). Course-level `srs_enabled` must also be true.
pub fn srs_practice_globally_enabled() -> bool {
    match env::var("SRS_PRACTICE_ENABLED") {
        Ok(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

pub fn srs_active_for_course(global_on: bool, course_flag: bool) -> bool {
    global_on && course_flag
}

fn add_interval_days(now: chrono::DateTime<Utc>, days: f64) -> chrono::DateTime<Utc> {
    let secs = (days * 86400.0).round() as i64;
    now + Duration::try_seconds(secs).unwrap_or_else(|| Duration::seconds(0))
}

fn grade_to_mastery_score(grade: &str) -> f64 {
    match grade.trim().to_ascii_lowercase().as_str() {
        "again" => 0.0,
        "hard" => 0.35,
        "good" => 0.85,
        "easy" => 1.0,
        _ => 0.5,
    }
}

pub async fn maybe_seed_after_quiz_exposure<'e, E>(
    ex: E,
    course_row: &CoursePublic,
    user_id: Uuid,
    question_id: Uuid,
    srs_eligible: bool,
) -> Result<(), sqlx::Error>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    if !srs_eligible {
        return Ok(());
    }
    if !srs_active_for_course(srs_practice_globally_enabled(), course_row.srs_enabled) {
        return Ok(());
    }
    srs_repo::seed_state_if_absent(ex, user_id, question_id).await?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueueItemResponse {
    pub state_id: Uuid,
    pub question_id: Uuid,
    pub course_id: Uuid,
    pub course_code: String,
    pub course_title: String,
    pub next_review_at: chrono::DateTime<Utc>,
    pub stem: String,
    pub question_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correct_answer: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueueResponse {
    pub items: Vec<ReviewQueueItemResponse>,
    pub total_due: i64,
}

pub async fn get_review_queue(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<ReviewQueueResponse, AppError> {
    let total = srs_repo::count_due_for_user(pool, user_id)
        .await
        .map_err(AppError::Db)?;
    let rows = srs_repo::list_review_queue(pool, user_id, limit, offset)
        .await
        .map_err(AppError::Db)?;
    let items = rows
        .into_iter()
        .map(|r| ReviewQueueItemResponse {
            state_id: r.state_id,
            question_id: r.question_id,
            course_id: r.course_id,
            course_code: r.course_code,
            course_title: r.course_title,
            next_review_at: r.next_review_at,
            stem: r.stem,
            question_type: r.question_type,
            options: r.options,
            correct_answer: r.correct_answer,
            explanation: r.explanation,
        })
        .collect();
    Ok(ReviewQueueResponse {
        items,
        total_due: total,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStatsResponse {
    pub streak: i32,
    pub due_today: i64,
    pub due_week: i64,
    pub retention_estimate: f64,
}

fn end_of_utc_day(now: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    let d = now.date_naive();
    d.and_hms_opt(23, 59, 59).unwrap().and_utc() + Duration::milliseconds(999)
}

pub async fn get_review_stats(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<ReviewStatsResponse, AppError> {
    let today_end = end_of_utc_day(Utc::now());
    let due_today = srs_repo::count_due_until(pool, user_id, today_end)
        .await
        .map_err(AppError::Db)?;
    let week_end = Utc::now() + Duration::days(7);
    let due_week = srs_repo::count_due_until(pool, user_id, week_end)
        .await
        .map_err(AppError::Db)?;
    let streak = streak_for_user(pool, user_id).await.map_err(AppError::Db)?;
    let avg_ef = srs_repo::avg_easiness_for_user(pool, user_id)
        .await
        .map_err(AppError::Db)?
        .unwrap_or(2.5);
    let retention_estimate = ((avg_ef - 1.3) / 1.2).clamp(0.0, 0.99);

    Ok(ReviewStatsResponse {
        streak,
        due_today,
        due_week,
        retention_estimate,
    })
}

async fn streak_for_user(pool: &PgPool, user_id: Uuid) -> Result<i32, sqlx::Error> {
    let today: NaiveDate = Utc::now().date_naive();
    let yesterday = today.pred_opt().unwrap_or(today);
    let anchor = if srs_repo::has_streak_day(pool, user_id, today).await? {
        today
    } else {
        yesterday
    };
    if !srs_repo::has_streak_day(pool, user_id, anchor).await? {
        return Ok(0);
    }
    let mut streak = 0i32;
    let mut d = anchor;
    while srs_repo::has_streak_day(pool, user_id, d).await? {
        streak += 1;
        let Some(prev) = d.pred_opt() else {
            break;
        };
        d = prev;
    }
    Ok(streak)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitSrsReviewBody {
    pub question_id: Uuid,
    pub grade: String,
    #[serde(default)]
    pub response_ms: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitSrsReviewResponse {
    pub next_review_at: chrono::DateTime<Utc>,
    pub interval_days: f64,
}

pub async fn submit_review(
    pool: &PgPool,
    actor_user_id: Uuid,
    target_user_id: Uuid,
    body: SubmitSrsReviewBody,
) -> Result<SubmitSrsReviewResponse, AppError> {
    if actor_user_id != target_user_id {
        return Err(AppError::Forbidden);
    }
    let Some(meta) = srs_repo::get_question_srs_meta(pool, body.question_id)
        .await
        .map_err(AppError::Db)?
    else {
        return Err(AppError::NotFound);
    };
    if !meta.srs_eligible {
        return Err(AppError::invalid_input(
            "This question is not enabled for spaced repetition.",
        ));
    }
    if !srs_active_for_course(srs_practice_globally_enabled(), meta.srs_enabled) {
        return Err(AppError::invalid_input(
            "Spaced repetition is not enabled for this course.",
        ));
    }
    let enrolled = enrollment::user_has_access(pool, &meta.course_code, target_user_id)
        .await
        .map_err(AppError::Db)?;
    if !enrolled {
        return Err(AppError::Forbidden);
    }

    let q =
        grade_to_quality(&body.grade).ok_or_else(|| AppError::invalid_input("Invalid grade."))?;
    let grade_db = body.grade.trim().to_ascii_lowercase();
    let concept_tag_map = concepts::concept_ids_for_question_ids(pool, &[body.question_id])
        .await
        .map_err(AppError::Db)?;
    let tagged = concept_tag_map
        .get(&body.question_id)
        .cloned()
        .unwrap_or_default();

    let mut tx = pool.begin().await.map_err(AppError::Db)?;
    let locked = srs_repo::lock_state_for_user_question(&mut *tx, target_user_id, body.question_id)
        .await
        .map_err(AppError::Db)?;
    let prev = locked
        .as_ref()
        .map(|r| Sm2State {
            easiness_factor: r.easiness_factor,
            repetition: r.repetition,
            interval_days: r.interval_days,
        })
        .unwrap_or_default();
    let was_overdue = locked
        .as_ref()
        .map(|r| r.next_review_at <= Utc::now())
        .unwrap_or(false);
    let due_increment = if was_overdue { 1 } else { 0 };

    let next_sm2 = sm2_step(&prev, q);
    let now = Utc::now();
    let next_review_at = add_interval_days(now, next_sm2.interval_days);

    let event_id = srs_repo::insert_review_event(
        &mut *tx,
        target_user_id,
        body.question_id,
        &grade_db,
        Some(prev.interval_days),
        next_sm2.interval_days,
        Some(prev.easiness_factor),
        next_sm2.easiness_factor,
        body.response_ms,
    )
    .await
    .map_err(AppError::Db)?;

    srs_repo::upsert_srs_state(
        &mut *tx,
        target_user_id,
        body.question_id,
        next_sm2.interval_days,
        next_sm2.repetition,
        next_sm2.easiness_factor,
        next_review_at,
        due_increment,
    )
    .await
    .map_err(AppError::Db)?;

    if learner_state::learner_model_enabled() {
        let alpha = learner_state::learner_ema_alpha();
        let score = grade_to_mastery_score(&body.grade);
        for cid in tagged {
            let input = LearnerSrsMasteryInput {
                user_id: target_user_id,
                course_id: meta.course_id,
                concept_id: cid,
                score,
                review_event_id: event_id,
                ema_alpha: alpha,
            };
            learner_model::apply_srs_mastery_update_in_tx(&mut *tx, &input)
                .await
                .map_err(AppError::Db)?;
        }
    }

    tx.commit().await.map_err(AppError::Db)?;

    tracing::info!(
        target: "srs",
        user_id = %target_user_id,
        question_id = %body.question_id,
        grade = %body.grade,
        "srs_review"
    );

    let remaining = srs_repo::count_due_for_user(pool, target_user_id)
        .await
        .map_err(AppError::Db)?;
    if remaining == 0 {
        let day = Utc::now().date_naive();
        srs_repo::insert_streak_day(pool, target_user_id, day)
            .await
            .map_err(AppError::Db)?;
    }

    Ok(SubmitSrsReviewResponse {
        next_review_at,
        interval_days: next_sm2.interval_days,
    })
}
