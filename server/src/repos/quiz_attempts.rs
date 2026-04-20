//! Quiz attempt storage (`course.quiz_attempts`, `course.quiz_responses`).

use crate::db::schema;
use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct QuizAttemptRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub structure_item_id: Uuid,
    pub student_user_id: Uuid,
    pub attempt_number: i32,
    pub status: String,
    pub is_adaptive: bool,
    pub started_at: DateTime<Utc>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub points_earned: Option<f64>,
    pub points_possible: Option<f64>,
    pub score_percent: Option<f32>,
    pub adaptive_history_json: Option<JsonValue>,
    pub current_question_index: i32,
    pub academic_integrity_flag: bool,
    pub deadline_at: Option<DateTime<Utc>>,
    pub extended_time_applied: bool,
}

pub async fn get_attempt(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Option<QuizAttemptRow>, sqlx::Error> {
    sqlx::query_as::<_, QuizAttemptRowDb>(&format!(
        r#"
        SELECT id, course_id, structure_item_id, student_user_id, attempt_number, status,
               is_adaptive, started_at, submitted_at, points_earned, points_possible, score_percent,
               adaptive_history_json, current_question_index, academic_integrity_flag,
               deadline_at, extended_time_applied
        FROM {}
        WHERE id = $1
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(attempt_id)
    .fetch_optional(pool)
    .await
    .map(|o| o.map(Into::into))
}

pub async fn find_in_progress(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    user_id: Uuid,
) -> Result<Option<QuizAttemptRow>, sqlx::Error> {
    sqlx::query_as::<_, QuizAttemptRowDb>(&format!(
        r#"
        SELECT id, course_id, structure_item_id, student_user_id, attempt_number, status,
               is_adaptive, started_at, submitted_at, points_earned, points_possible, score_percent,
               adaptive_history_json, current_question_index, academic_integrity_flag,
               deadline_at, extended_time_applied
        FROM {}
        WHERE course_id = $1 AND structure_item_id = $2 AND student_user_id = $3
          AND status = 'in_progress'
        ORDER BY started_at DESC
        LIMIT 1
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(item_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map(|o| o.map(Into::into))
}

pub async fn count_submitted_attempts(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    user_id: Uuid,
) -> Result<i64, sqlx::Error> {
    let (n,): (i64,) = sqlx::query_as(&format!(
        r#"
        SELECT COUNT(*)::bigint FROM {}
        WHERE course_id = $1 AND structure_item_id = $2 AND student_user_id = $3
          AND status = 'submitted'
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(item_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn next_attempt_number(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    user_id: Uuid,
) -> Result<i32, sqlx::Error> {
    let (max_n,): (Option<i32>,) = sqlx::query_as(&format!(
        r#"
        SELECT MAX(attempt_number) FROM {}
        WHERE course_id = $1 AND structure_item_id = $2 AND student_user_id = $3
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(item_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(max_n.unwrap_or(0) + 1)
}

pub async fn create_attempt(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    user_id: Uuid,
    attempt_number: i32,
    is_adaptive: bool,
    deadline_at: Option<DateTime<Utc>>,
    extended_time_applied: bool,
) -> Result<QuizAttemptRow, sqlx::Error> {
    let row = sqlx::query_as::<_, QuizAttemptRowDb>(&format!(
        r#"
        INSERT INTO {} (
            course_id, structure_item_id, student_user_id, attempt_number, status, is_adaptive,
            deadline_at, extended_time_applied
        )
        VALUES ($1, $2, $3, $4, 'in_progress', $5, $6, $7)
        RETURNING id, course_id, structure_item_id, student_user_id, attempt_number, status,
                  is_adaptive, started_at, submitted_at, points_earned, points_possible, score_percent,
                  adaptive_history_json, current_question_index, academic_integrity_flag,
                  deadline_at, extended_time_applied
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(item_id)
    .bind(user_id)
    .bind(attempt_number)
    .bind(is_adaptive)
    .bind(deadline_at)
    .bind(extended_time_applied)
    .fetch_one(pool)
    .await?;
    Ok(row.into())
}

pub async fn finalize_attempt<'e, E>(
    executor: E,
    attempt_id: Uuid,
    submitted_at: DateTime<Utc>,
    points_earned: f64,
    points_possible: f64,
    score_percent: f32,
    adaptive_history: Option<&JsonValue>,
    academic_integrity_flag: bool,
) -> Result<bool, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let r = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'submitted',
            submitted_at = $2,
            points_earned = $3,
            points_possible = $4,
            score_percent = $5,
            adaptive_history_json = COALESCE($6, adaptive_history_json),
            academic_integrity_flag = $7
        WHERE id = $1 AND status = 'in_progress'
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(attempt_id)
    .bind(submitted_at)
    .bind(points_earned)
    .bind(points_possible)
    .bind(score_percent)
    .bind(adaptive_history)
    .bind(academic_integrity_flag)
    .execute(executor)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn finalize_attempt_auto_submitted<'e, E>(
    executor: E,
    attempt_id: Uuid,
    submitted_at: DateTime<Utc>,
    points_earned: f64,
    points_possible: f64,
    score_percent: f32,
) -> Result<bool, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let r = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'submitted',
            submitted_at = $2,
            points_earned = $3,
            points_possible = $4,
            score_percent = $5,
            auto_submitted = TRUE
        WHERE id = $1
          AND status = 'in_progress'
          AND deadline_at IS NOT NULL
          AND deadline_at <= $2
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(attempt_id)
    .bind(submitted_at)
    .bind(points_earned)
    .bind(points_possible)
    .bind(score_percent)
    .execute(executor)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn list_expired_in_progress_attempt_ids(
    pool: &PgPool,
    now: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT id
        FROM {}
        WHERE status = 'in_progress'
          AND deadline_at IS NOT NULL
          AND deadline_at <= $1
        ORDER BY deadline_at ASC
        LIMIT $2
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(now)
    .bind(limit.max(1))
    .fetch_all(pool)
    .await
}

pub async fn sum_response_points_for_attempt<'e, E>(
    executor: E,
    attempt_id: Uuid,
) -> Result<(f64, f64), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let row: (Option<f64>, Option<f64>) = sqlx::query_as(&format!(
        r#"
        SELECT COALESCE(SUM(points_awarded), 0)::float8 AS earned,
               COALESCE(SUM(max_points), 0)::float8 AS possible
        FROM {}
        WHERE attempt_id = $1
        "#,
        schema::QUIZ_RESPONSES
    ))
    .bind(attempt_id)
    .fetch_one(executor)
    .await?;
    Ok((row.0.unwrap_or(0.0), row.1.unwrap_or(0.0)))
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuizResponseRow {
    pub question_index: i32,
    pub question_id: Option<String>,
    pub question_type: String,
    pub prompt_snapshot: Option<String>,
    pub response_json: JsonValue,
    pub is_correct: Option<bool>,
    pub points_awarded: Option<f64>,
    pub max_points: f64,
    pub locked: bool,
}

pub async fn list_responses(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Vec<QuizResponseRow>, sqlx::Error> {
    sqlx::query_as::<_, QuizResponseRow>(&format!(
        r#"
        SELECT question_index, question_id, question_type, prompt_snapshot, response_json,
               is_correct, points_awarded, max_points, locked
        FROM {}
        WHERE attempt_id = $1
        ORDER BY question_index ASC
        "#,
        schema::QUIZ_RESPONSES
    ))
    .bind(attempt_id)
    .fetch_all(pool)
    .await
}

pub async fn insert_response<'e, E>(
    executor: E,
    attempt_id: Uuid,
    question_index: i32,
    question_id: Option<&str>,
    question_type: &str,
    prompt_snapshot: Option<&str>,
    response_json: &JsonValue,
    is_correct: Option<bool>,
    points_awarded: Option<f64>,
    max_points: f64,
    locked: bool,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            attempt_id, question_index, question_id, question_type, prompt_snapshot,
            response_json, is_correct, points_awarded, max_points, locked
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
        schema::QUIZ_RESPONSES
    ))
    .bind(attempt_id)
    .bind(question_index)
    .bind(question_id)
    .bind(question_type)
    .bind(prompt_snapshot)
    .bind(response_json)
    .bind(is_correct)
    .bind(points_awarded)
    .bind(max_points)
    .bind(locked)
    .execute(executor)
    .await?;
    Ok(())
}

/// Returns true if the row existed with `locked = true` (advance must reject).
pub async fn response_is_locked(
    pool: &PgPool,
    attempt_id: Uuid,
    question_index: i32,
) -> Result<bool, sqlx::Error> {
    let row: Option<(bool,)> = sqlx::query_as(&format!(
        r#"SELECT locked FROM {} WHERE attempt_id = $1 AND question_index = $2"#,
        schema::QUIZ_RESPONSES
    ))
    .bind(attempt_id)
    .bind(question_index)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(l,)| l).unwrap_or(false))
}

pub async fn bump_current_question_index<'e, E>(
    executor: E,
    attempt_id: Uuid,
    expected_index: i32,
) -> Result<bool, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let r = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET current_question_index = current_question_index + 1
        WHERE id = $1 AND status = 'in_progress' AND current_question_index = $2
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(attempt_id)
    .bind(expected_index)
    .execute(executor)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn count_focus_loss_events(pool: &PgPool, attempt_id: Uuid) -> Result<i64, sqlx::Error> {
    let (n,): (i64,) = sqlx::query_as(&format!(
        r#"SELECT COUNT(*)::bigint FROM {} WHERE attempt_id = $1"#,
        schema::ATTEMPT_FOCUS_LOSS_EVENTS
    ))
    .bind(attempt_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn insert_focus_loss_event(
    pool: &PgPool,
    attempt_id: Uuid,
    event_type: &str,
    duration_ms: Option<i32>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (attempt_id, event_type, duration_ms)
        VALUES ($1, $2, $3)
        "#,
        schema::ATTEMPT_FOCUS_LOSS_EVENTS
    ))
    .bind(attempt_id)
    .bind(event_type)
    .bind(duration_ms)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FocusLossEventRow {
    pub id: Uuid,
    pub event_type: String,
    pub duration_ms: Option<i32>,
    pub created_at: DateTime<Utc>,
}

pub async fn list_focus_loss_events(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Vec<FocusLossEventRow>, sqlx::Error> {
    sqlx::query_as::<_, FocusLossEventRow>(&format!(
        r#"
        SELECT id, event_type, duration_ms, created_at
        FROM {}
        WHERE attempt_id = $1
        ORDER BY created_at ASC
        "#,
        schema::ATTEMPT_FOCUS_LOSS_EVENTS
    ))
    .bind(attempt_id)
    .fetch_all(pool)
    .await
}

pub async fn delete_responses_for_attempt<'e, E>(executor: E, attempt_id: Uuid) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE attempt_id = $1"#,
        schema::QUIZ_RESPONSES
    ))
    .bind(attempt_id)
    .execute(executor)
    .await?;
    Ok(())
}

/// Removes an in-progress attempt row (responses and attempt selections cascade).
pub async fn delete_attempt(pool: &PgPool, attempt_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $1"#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(attempt_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_submitted_attempts_for_item_student(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<QuizAttemptRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, QuizAttemptRowDb>(&format!(
        r#"
        SELECT id, course_id, structure_item_id, student_user_id, attempt_number, status,
               is_adaptive, started_at, submitted_at, points_earned, points_possible, score_percent,
               adaptive_history_json, current_question_index, academic_integrity_flag,
               deadline_at, extended_time_applied
        FROM {}
        WHERE course_id = $1 AND structure_item_id = $2 AND student_user_id = $3
          AND status = 'submitted'
        ORDER BY submitted_at ASC NULLS LAST, attempt_number ASC
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(item_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn latest_submitted_attempt(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    user_id: Uuid,
) -> Result<Option<QuizAttemptRow>, sqlx::Error> {
    sqlx::query_as::<_, QuizAttemptRowDb>(&format!(
        r#"
        SELECT id, course_id, structure_item_id, student_user_id, attempt_number, status,
               is_adaptive, started_at, submitted_at, points_earned, points_possible, score_percent,
               adaptive_history_json, current_question_index, academic_integrity_flag,
               deadline_at, extended_time_applied
        FROM {}
        WHERE course_id = $1 AND structure_item_id = $2 AND student_user_id = $3
          AND status = 'submitted'
        ORDER BY submitted_at DESC NULLS LAST
        LIMIT 1
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(item_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map(|o| o.map(Into::into))
}

#[derive(sqlx::FromRow)]
struct QuizAttemptRowDb {
    id: Uuid,
    course_id: Uuid,
    structure_item_id: Uuid,
    student_user_id: Uuid,
    attempt_number: i32,
    status: String,
    is_adaptive: bool,
    started_at: DateTime<Utc>,
    submitted_at: Option<DateTime<Utc>>,
    points_earned: Option<f64>,
    points_possible: Option<f64>,
    score_percent: Option<f32>,
    adaptive_history_json: Option<JsonValue>,
    current_question_index: i32,
    academic_integrity_flag: bool,
    deadline_at: Option<DateTime<Utc>>,
    extended_time_applied: bool,
}

impl From<QuizAttemptRowDb> for QuizAttemptRow {
    fn from(r: QuizAttemptRowDb) -> Self {
        QuizAttemptRow {
            id: r.id,
            course_id: r.course_id,
            structure_item_id: r.structure_item_id,
            student_user_id: r.student_user_id,
            attempt_number: r.attempt_number,
            status: r.status,
            is_adaptive: r.is_adaptive,
            started_at: r.started_at,
            submitted_at: r.submitted_at,
            points_earned: r.points_earned,
            points_possible: r.points_possible,
            score_percent: r.score_percent,
            adaptive_history_json: r.adaptive_history_json,
            current_question_index: r.current_question_index,
            academic_integrity_flag: r.academic_integrity_flag,
            deadline_at: r.deadline_at,
            extended_time_applied: r.extended_time_applied,
        }
    }
}
