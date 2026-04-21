//! Question hints, worked examples, and per-attempt hint request log (plan 1.9).

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuestionHintRow {
    pub id: Uuid,
    pub question_id: Uuid,
    pub level: i16,
    pub body: String,
    pub media_url: Option<String>,
    pub locale: String,
    pub penalty_pct: f64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WorkedExampleRow {
    pub id: Uuid,
    pub question_id: Uuid,
    pub title: Option<String>,
    pub body: Option<String>,
    pub steps: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

pub async fn list_hints_for_question_locale(
    pool: &PgPool,
    question_id: Uuid,
    locale: &str,
) -> Result<Vec<QuestionHintRow>, sqlx::Error> {
    sqlx::query_as::<_, QuestionHintRow>(&format!(
        r#"
        SELECT id, question_id, level, body, media_url, locale,
               (penalty_pct)::float8 AS penalty_pct, created_at
        FROM {}
        WHERE question_id = $1 AND locale = $2
        ORDER BY level ASC
        "#,
        schema::QUESTION_HINTS
    ))
    .bind(question_id)
    .bind(locale)
    .fetch_all(pool)
    .await
}

pub async fn insert_hint(
    pool: &PgPool,
    question_id: Uuid,
    level: i16,
    body: &str,
    media_url: Option<&str>,
    locale: &str,
    penalty_pct: f64,
) -> Result<QuestionHintRow, sqlx::Error> {
    sqlx::query_as::<_, QuestionHintRow>(&format!(
        r#"
        INSERT INTO {} (question_id, level, body, media_url, locale, penalty_pct)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, question_id, level, body, media_url, locale,
                  (penalty_pct)::float8 AS penalty_pct, created_at
        "#,
        schema::QUESTION_HINTS
    ))
    .bind(question_id)
    .bind(level)
    .bind(body)
    .bind(media_url)
    .bind(locale)
    .bind(penalty_pct)
    .fetch_one(pool)
    .await
}

pub async fn update_hint(
    pool: &PgPool,
    hint_id: Uuid,
    question_id: Uuid,
    level: i16,
    body: &str,
    media_url: Option<&str>,
    locale: &str,
    penalty_pct: f64,
) -> Result<Option<QuestionHintRow>, sqlx::Error> {
    sqlx::query_as::<_, QuestionHintRow>(&format!(
        r#"
        UPDATE {}
        SET level = $3, body = $4, media_url = $5, locale = $6, penalty_pct = $7
        WHERE id = $1 AND question_id = $2
        RETURNING id, question_id, level, body, media_url, locale,
                  (penalty_pct)::float8 AS penalty_pct, created_at
        "#,
        schema::QUESTION_HINTS
    ))
    .bind(hint_id)
    .bind(question_id)
    .bind(level)
    .bind(body)
    .bind(media_url)
    .bind(locale)
    .bind(penalty_pct)
    .fetch_optional(pool)
    .await
}

pub async fn delete_hint(pool: &PgPool, hint_id: Uuid, question_id: Uuid) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $1 AND question_id = $2"#,
        schema::QUESTION_HINTS
    ))
    .bind(hint_id)
    .bind(question_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

pub async fn get_worked_example(
    pool: &PgPool,
    question_id: Uuid,
) -> Result<Option<WorkedExampleRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkedExampleRow>(&format!(
        r#"
        SELECT id, question_id, title, body, steps, created_at
        FROM {}
        WHERE question_id = $1
        "#,
        schema::QUESTION_WORKED_EXAMPLES
    ))
    .bind(question_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_worked_example(
    pool: &PgPool,
    question_id: Uuid,
    title: Option<&str>,
    body: Option<&str>,
    steps: &serde_json::Value,
) -> Result<WorkedExampleRow, sqlx::Error> {
    sqlx::query_as::<_, WorkedExampleRow>(&format!(
        r#"
        INSERT INTO {} (question_id, title, body, steps)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (question_id) DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            steps = EXCLUDED.steps
        RETURNING id, question_id, title, body, steps, created_at
        "#,
        schema::QUESTION_WORKED_EXAMPLES
    ))
    .bind(question_id)
    .bind(title)
    .bind(body)
    .bind(steps)
    .fetch_one(pool)
    .await
}

pub async fn max_hint_level_used(
    pool: &PgPool,
    attempt_id: Uuid,
    question_id: &str,
) -> Result<Option<i16>, sqlx::Error> {
    let row: Option<(Option<i16>,)> = sqlx::query_as(&format!(
        r#"SELECT MAX(hint_level) FROM {} WHERE attempt_id = $1 AND question_id = $2"#,
        schema::HINT_REQUESTS
    ))
    .bind(attempt_id)
    .bind(question_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| r.0))
}

pub async fn count_hint_requests(
    pool: &PgPool,
    attempt_id: Uuid,
    question_id: &str,
) -> Result<i64, sqlx::Error> {
    let (n,): (i64,) = sqlx::query_as(&format!(
        r#"SELECT COUNT(*)::bigint FROM {} WHERE attempt_id = $1 AND question_id = $2"#,
        schema::HINT_REQUESTS
    ))
    .bind(attempt_id)
    .bind(question_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn insert_hint_request(
    pool: &PgPool,
    attempt_id: Uuid,
    question_id: &str,
    hint_level: i16,
    hint_type: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (attempt_id, question_id, hint_level, hint_type)
        VALUES ($1, $2, $3, $4)
        "#,
        schema::HINT_REQUESTS
    ))
    .bind(attempt_id)
    .bind(question_id)
    .bind(hint_level)
    .bind(hint_type)
    .execute(pool)
    .await?;
    Ok(())
}

/// Sum of configured `penalty_pct` for each static hint level that was revealed on this attempt/question.
pub async fn sum_static_penalty_pct_for_attempt_question(
    pool: &PgPool,
    attempt_id: Uuid,
    question_id: Uuid,
    question_id_text: &str,
    locale: &str,
) -> Result<f64, sqlx::Error> {
    let row: (f64,) = sqlx::query_as(&format!(
        r#"
        SELECT COALESCE(SUM((h.penalty_pct)::float8), 0.0)::float8
        FROM {} r
        INNER JOIN {} h
          ON h.question_id = $3
         AND h.level = r.hint_level
         AND h.locale = $4
        WHERE r.attempt_id = $1
          AND r.question_id = $2
          AND r.hint_type = 'static'
        "#,
        schema::HINT_REQUESTS,
        schema::QUESTION_HINTS
    ))
    .bind(attempt_id)
    .bind(question_id_text)
    .bind(question_id)
    .bind(locale)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn hint_use_counts_for_attempt(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<HashMap<String, i64>, sqlx::Error> {
    let rows: Vec<(String, i64)> = sqlx::query_as(&format!(
        r#"
        SELECT question_id, COUNT(*)::bigint
        FROM {}
        WHERE attempt_id = $1
        GROUP BY question_id
        "#,
        schema::HINT_REQUESTS
    ))
    .bind(attempt_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

pub async fn hint_levels_used_count(
    pool: &PgPool,
    attempt_id: Uuid,
    question_id: &str,
) -> Result<i64, sqlx::Error> {
    let (n,): (i64,) = sqlx::query_as(&format!(
        r#"SELECT COUNT(*)::bigint FROM {} WHERE attempt_id = $1 AND question_id = $2"#,
        schema::HINT_REQUESTS
    ))
    .bind(attempt_id)
    .bind(question_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn concept_names_for_question(
    pool: &PgPool,
    question_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(&format!(
        r#"
        SELECT c.name
        FROM {} t
        INNER JOIN {} c ON c.id = t.concept_id
        WHERE t.question_id = $1
        ORDER BY c.name ASC
        "#,
        schema::CONCEPT_QUESTION_TAGS,
        schema::CONCEPTS
    ))
    .bind(question_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct HintAnalyticsLevelRow {
    pub level: i16,
    pub request_count: i64,
    pub distinct_students: i64,
}

pub async fn hint_distinct_students_for_question(
    pool: &PgPool,
    question_id: &str,
) -> Result<i64, sqlx::Error> {
    let (n,): (i64,) = sqlx::query_as(&format!(
        r#"
        SELECT COUNT(DISTINCT qa.student_user_id)::bigint
        FROM {} r
        INNER JOIN {} qa ON qa.id = r.attempt_id
        WHERE r.question_id = $1
        "#,
        schema::HINT_REQUESTS,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(question_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn hint_analytics_for_question(
    pool: &PgPool,
    question_id: &str,
) -> Result<Vec<HintAnalyticsLevelRow>, sqlx::Error> {
    sqlx::query_as::<_, HintAnalyticsLevelRow>(&format!(
        r#"
        SELECT
            r.hint_level AS level,
            COUNT(*)::bigint AS request_count,
            COUNT(DISTINCT qa.student_user_id)::bigint AS distinct_students
        FROM {} r
        INNER JOIN {} qa ON qa.id = r.attempt_id
        WHERE r.question_id = $1
        GROUP BY r.hint_level
        ORDER BY r.hint_level ASC
        "#,
        schema::HINT_REQUESTS,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(question_id)
    .fetch_all(pool)
    .await
}
