//! Persistence for spaced repetition queues, state, and audit events.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SrsItemStateRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub question_id: Uuid,
    pub algorithm: String,
    pub interval_days: f64,
    pub repetition: i32,
    pub easiness_factor: f64,
    pub next_review_at: DateTime<Utc>,
    pub due_count: i32,
    pub suppressed_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SrsReviewQueueRow {
    pub state_id: Uuid,
    pub question_id: Uuid,
    pub course_id: Uuid,
    pub course_code: String,
    pub course_title: String,
    pub next_review_at: DateTime<Utc>,
    pub stem: String,
    pub question_type: String,
    pub options: Option<serde_json::Value>,
    pub correct_answer: Option<serde_json::Value>,
    pub explanation: Option<String>,
}

pub async fn count_due_for_user(pool: &PgPool, user_id: Uuid) -> Result<i64, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(&format!(
        r#"
        SELECT COUNT(*)::int8
        FROM {} s
        INNER JOIN {} q ON q.id = s.question_id
        INNER JOIN {} c ON c.id = q.course_id
        INNER JOIN {} e ON e.course_id = q.course_id AND e.user_id = s.user_id
        WHERE s.user_id = $1
          AND c.srs_enabled = TRUE
          AND q.srs_eligible = TRUE
          AND s.next_review_at <= NOW()
          AND (s.suppressed_until IS NULL OR s.suppressed_until < NOW())
        "#,
        schema::SRS_ITEM_STATES,
        schema::QUESTIONS,
        schema::COURSES,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn count_due_until(
    pool: &PgPool,
    user_id: Uuid,
    until: DateTime<Utc>,
) -> Result<i64, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(&format!(
        r#"
        SELECT COUNT(*)::int8
        FROM {} s
        INNER JOIN {} q ON q.id = s.question_id
        INNER JOIN {} c ON c.id = q.course_id
        INNER JOIN {} e ON e.course_id = q.course_id AND e.user_id = s.user_id
        WHERE s.user_id = $1
          AND c.srs_enabled = TRUE
          AND q.srs_eligible = TRUE
          AND s.next_review_at <= $2
          AND (s.suppressed_until IS NULL OR s.suppressed_until < NOW())
        "#,
        schema::SRS_ITEM_STATES,
        schema::QUESTIONS,
        schema::COURSES,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(user_id)
    .bind(until)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn list_review_queue(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<SrsReviewQueueRow>, sqlx::Error> {
    sqlx::query_as::<_, SrsReviewQueueRow>(&format!(
        r#"
        SELECT
            s.id AS state_id,
            s.question_id,
            q.course_id,
            c.course_code,
            c.title AS course_title,
            s.next_review_at,
            q.stem,
            q.question_type::text AS question_type,
            q.options,
            q.correct_answer,
            q.explanation
        FROM {} s
        INNER JOIN {} q ON q.id = s.question_id
        INNER JOIN {} c ON c.id = q.course_id
        INNER JOIN {} e ON e.course_id = q.course_id AND e.user_id = s.user_id
        WHERE s.user_id = $1
          AND c.srs_enabled = TRUE
          AND q.srs_eligible = TRUE
          AND s.next_review_at <= NOW()
          AND (s.suppressed_until IS NULL OR s.suppressed_until < NOW())
        ORDER BY s.next_review_at ASC, s.question_id ASC
        LIMIT $2 OFFSET $3
        "#,
        schema::SRS_ITEM_STATES,
        schema::QUESTIONS,
        schema::COURSES,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn list_review_queue_for_course(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<SrsReviewQueueRow>, sqlx::Error> {
    sqlx::query_as::<_, SrsReviewQueueRow>(&format!(
        r#"
        SELECT
            s.id AS state_id,
            s.question_id,
            q.course_id,
            c.course_code,
            c.title AS course_title,
            s.next_review_at,
            q.stem,
            q.question_type::text AS question_type,
            q.options,
            q.correct_answer,
            q.explanation
        FROM {} s
        INNER JOIN {} q ON q.id = s.question_id
        INNER JOIN {} c ON c.id = q.course_id
        INNER JOIN {} e ON e.course_id = q.course_id AND e.user_id = s.user_id
        WHERE s.user_id = $1
          AND q.course_id = $2
          AND c.srs_enabled = TRUE
          AND q.srs_eligible = TRUE
          AND s.next_review_at <= NOW()
          AND (s.suppressed_until IS NULL OR s.suppressed_until < NOW())
        ORDER BY s.next_review_at ASC, s.question_id ASC
        LIMIT $3 OFFSET $4
        "#,
        schema::SRS_ITEM_STATES,
        schema::QUESTIONS,
        schema::COURSES,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_state_for_user_question<'e, E>(
    ex: E,
    user_id: Uuid,
    question_id: Uuid,
) -> Result<Option<SrsItemStateRow>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query_as::<_, SrsItemStateRow>(&format!(
        r#"
        SELECT
            s.id,
            s.user_id,
            s.question_id,
            s.algorithm::text,
            (s.interval_days)::float8,
            s.repetition,
            (s.easiness_factor)::float8,
            s.next_review_at,
            s.due_count,
            s.suppressed_until
        FROM {} s
        WHERE s.user_id = $1 AND s.question_id = $2
        "#,
        schema::SRS_ITEM_STATES
    ))
    .bind(user_id)
    .bind(question_id)
    .fetch_optional(ex)
    .await
}

pub async fn lock_state_for_user_question<'e, E>(
    ex: E,
    user_id: Uuid,
    question_id: Uuid,
) -> Result<Option<SrsItemStateRow>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query_as::<_, SrsItemStateRow>(&format!(
        r#"
        SELECT
            s.id,
            s.user_id,
            s.question_id,
            s.algorithm::text,
            (s.interval_days)::float8,
            s.repetition,
            (s.easiness_factor)::float8,
            s.next_review_at,
            s.due_count,
            s.suppressed_until
        FROM {} s
        WHERE s.user_id = $1 AND s.question_id = $2
        FOR UPDATE
        "#,
        schema::SRS_ITEM_STATES
    ))
    .bind(user_id)
    .bind(question_id)
    .fetch_optional(ex)
    .await
}

pub async fn insert_review_event<'e, E>(
    ex: E,
    user_id: Uuid,
    question_id: Uuid,
    grade: &str,
    interval_before: Option<f64>,
    interval_after: f64,
    ef_before: Option<f64>,
    ef_after: f64,
    response_ms: Option<i32>,
) -> Result<Uuid, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (
            user_id, question_id, grade, interval_before, interval_after,
            ef_before, ef_after, response_ms
        )
        VALUES (
            $1, $2, $3::course.srs_grade, $4::numeric, $5::numeric,
            $6::numeric, $7::numeric, $8
        )
        RETURNING id
        "#,
        schema::SRS_REVIEW_EVENTS
    ))
    .bind(user_id)
    .bind(question_id)
    .bind(grade)
    .bind(interval_before)
    .bind(interval_after)
    .bind(ef_before)
    .bind(ef_after)
    .bind(response_ms)
    .fetch_one(ex)
    .await?;
    Ok(id)
}

pub async fn upsert_srs_state<'e, E>(
    ex: E,
    user_id: Uuid,
    question_id: Uuid,
    interval_days: f64,
    repetition: i32,
    easiness_factor: f64,
    next_review_at: DateTime<Utc>,
    due_increment: i32,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            user_id, question_id, algorithm, interval_days, repetition,
            easiness_factor, next_review_at, due_count, updated_at
        )
        VALUES (
            $1, $2, 'sm2'::course.srs_algorithm, $3::numeric, $4,
            $5::numeric, $6, 0, NOW()
        )
        ON CONFLICT (user_id, question_id) DO UPDATE SET
            interval_days = EXCLUDED.interval_days,
            repetition = EXCLUDED.repetition,
            easiness_factor = EXCLUDED.easiness_factor,
            next_review_at = EXCLUDED.next_review_at,
            due_count = {}.due_count + $7,
            updated_at = NOW()
        "#,
        schema::SRS_ITEM_STATES,
        schema::SRS_ITEM_STATES
    ))
    .bind(user_id)
    .bind(question_id)
    .bind(interval_days)
    .bind(repetition)
    .bind(easiness_factor)
    .bind(next_review_at)
    .bind(due_increment)
    .execute(ex)
    .await?;
    Ok(())
}

/// Seeds first-time SRS rows after quiz exposure (does not reschedule existing rows).
pub async fn seed_state_if_absent<'e, E>(
    ex: E,
    user_id: Uuid,
    question_id: Uuid,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            user_id, question_id, algorithm, interval_days, repetition,
            easiness_factor, next_review_at, due_count, updated_at
        )
        VALUES (
            $1, $2, 'sm2'::course.srs_algorithm, 0::numeric, 0,
            2.5::numeric, NOW(), 0, NOW()
        )
        ON CONFLICT (user_id, question_id) DO NOTHING
        "#,
        schema::SRS_ITEM_STATES
    ))
    .bind(user_id)
    .bind(question_id)
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn has_streak_day(
    pool: &PgPool,
    user_id: Uuid,
    day: NaiveDate,
) -> Result<bool, sqlx::Error> {
    let v: Option<(Uuid,)> = sqlx::query_as(&format!(
        r#"SELECT user_id FROM {} WHERE user_id = $1 AND day_utc = $2"#,
        schema::SRS_STREAK_DAYS
    ))
    .bind(user_id)
    .bind(day)
    .fetch_optional(pool)
    .await?;
    Ok(v.is_some())
}

pub async fn insert_streak_day<'e, E>(
    ex: E,
    user_id: Uuid,
    day: NaiveDate,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, day_utc)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        "#,
        schema::SRS_STREAK_DAYS
    ))
    .bind(user_id)
    .bind(day)
    .execute(ex)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuestionSrsMetaRow {
    pub course_id: Uuid,
    pub srs_eligible: bool,
    pub srs_enabled: bool,
    pub course_code: String,
}

pub async fn get_question_srs_meta(
    pool: &PgPool,
    question_id: Uuid,
) -> Result<Option<QuestionSrsMetaRow>, sqlx::Error> {
    sqlx::query_as::<_, QuestionSrsMetaRow>(&format!(
        r#"
        SELECT
            q.course_id,
            q.srs_eligible,
            c.srs_enabled,
            c.course_code
        FROM {} q
        INNER JOIN {} c ON c.id = q.course_id
        WHERE q.id = $1
        "#,
        schema::QUESTIONS,
        schema::COURSES
    ))
    .bind(question_id)
    .fetch_optional(pool)
    .await
}

pub async fn avg_easiness_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<f64>, sqlx::Error> {
    let v: Option<f64> = sqlx::query_scalar(&format!(
        r#"
        SELECT AVG((s.easiness_factor)::float8)
        FROM {} s
        INNER JOIN {} q ON q.id = s.question_id
        INNER JOIN {} c ON c.id = q.course_id
        WHERE s.user_id = $1 AND c.srs_enabled = TRUE AND q.srs_eligible = TRUE
        "#,
        schema::SRS_ITEM_STATES,
        schema::QUESTIONS,
        schema::COURSES
    ))
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(v)
}
