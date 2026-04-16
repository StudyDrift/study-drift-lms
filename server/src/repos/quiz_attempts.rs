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
}

pub async fn get_attempt(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Option<QuizAttemptRow>, sqlx::Error> {
    sqlx::query_as::<_, QuizAttemptRowDb>(&format!(
        r#"
        SELECT id, course_id, structure_item_id, student_user_id, attempt_number, status,
               is_adaptive, started_at, submitted_at, points_earned, points_possible, score_percent,
               adaptive_history_json
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
               adaptive_history_json
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
) -> Result<QuizAttemptRow, sqlx::Error> {
    let row = sqlx::query_as::<_, QuizAttemptRowDb>(&format!(
        r#"
        INSERT INTO {} (
            course_id, structure_item_id, student_user_id, attempt_number, status, is_adaptive
        )
        VALUES ($1, $2, $3, $4, 'in_progress', $5)
        RETURNING id, course_id, structure_item_id, student_user_id, attempt_number, status,
                  is_adaptive, started_at, submitted_at, points_earned, points_possible, score_percent,
                  adaptive_history_json
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(item_id)
    .bind(user_id)
    .bind(attempt_number)
    .bind(is_adaptive)
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
            adaptive_history_json = COALESCE($6, adaptive_history_json)
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
    .execute(executor)
    .await?;
    Ok(r.rows_affected() > 0)
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
}

pub async fn list_responses(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Vec<QuizResponseRow>, sqlx::Error> {
    sqlx::query_as::<_, QuizResponseRow>(&format!(
        r#"
        SELECT question_index, question_id, question_type, prompt_snapshot, response_json,
               is_correct, points_awarded, max_points
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
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            attempt_id, question_index, question_id, question_type, prompt_snapshot,
            response_json, is_correct, points_awarded, max_points
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
    .execute(executor)
    .await?;
    Ok(())
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
               adaptive_history_json
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
               adaptive_history_json
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
        }
    }
}
