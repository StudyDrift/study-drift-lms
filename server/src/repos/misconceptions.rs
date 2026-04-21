//! Misconception library, option tags, events, and instructor reports (plan 1.10).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MisconceptionRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub concept_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub remediation_body: Option<String>,
    pub remediation_url: Option<String>,
    pub locale: String,
    pub is_seed: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MisconceptionReportRow {
    pub misconception_id: Uuid,
    pub misconception_name: String,
    pub question_id: Uuid,
    pub question_stem: String,
    pub trigger_count: i64,
    pub affected_students: i64,
    pub first_seen_at: Option<DateTime<Utc>>,
    pub last_seen_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MisconceptionSummaryRow {
    pub misconception_id: Uuid,
    pub name: String,
    pub trigger_count: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct QuestionOptionMisconceptionTagRow {
    pub option_id: Uuid,
    pub misconception_id: Uuid,
}

pub async fn list_option_tags_for_question(
    pool: &PgPool,
    question_id: Uuid,
) -> Result<Vec<QuestionOptionMisconceptionTagRow>, sqlx::Error> {
    sqlx::query_as::<_, QuestionOptionMisconceptionTagRow>(&format!(
        r#"
        SELECT option_id, misconception_id
        FROM {}
        WHERE question_id = $1
        ORDER BY option_id
        "#,
        schema::QUESTION_OPTION_MISCONCEPTION_TAGS
    ))
    .bind(question_id)
    .fetch_all(pool)
    .await
}

pub async fn misconception_name_exists_ci(
    pool: &PgPool,
    course_id: Uuid,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(&format!(
        r#"
        SELECT COUNT(*)::bigint FROM {}
        WHERE course_id = $1 AND lower(trim(name)) = lower(trim($2::text))
        "#,
        schema::MISCONCEPTIONS
    ))
    .bind(course_id)
    .bind(name)
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}

pub async fn delete_seed_misconceptions_for_course(pool: &PgPool, course_id: Uuid) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1 AND is_seed = TRUE"#,
        schema::MISCONCEPTIONS
    ))
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

pub async fn list_for_course(
    pool: &PgPool,
    course_id: Uuid,
    concept_id: Option<Uuid>,
    q: Option<&str>,
    limit: i64,
) -> Result<Vec<MisconceptionRow>, sqlx::Error> {
    let lim = limit.clamp(1, 500);
    let needle = q.map(|s| format!("%{}%", s.trim().to_lowercase()));
    if let Some(cid) = concept_id {
        if let Some(pat) = needle.as_ref() {
            return sqlx::query_as::<_, MisconceptionRow>(&format!(
                r#"
                SELECT id, course_id, concept_id, name, description, remediation_body, remediation_url,
                       locale, is_seed, created_at, updated_at
                FROM {}
                WHERE course_id = $1 AND concept_id = $2
                  AND (lower(name) LIKE $3 OR lower(COALESCE(description, '')) LIKE $3)
                ORDER BY name ASC
                LIMIT $4
                "#,
                schema::MISCONCEPTIONS
            ))
            .bind(course_id)
            .bind(cid)
            .bind(pat)
            .bind(lim)
            .fetch_all(pool)
            .await;
        }
        return sqlx::query_as::<_, MisconceptionRow>(&format!(
            r#"
            SELECT id, course_id, concept_id, name, description, remediation_body, remediation_url,
                   locale, is_seed, created_at, updated_at
            FROM {}
            WHERE course_id = $1 AND concept_id = $2
            ORDER BY name ASC
            LIMIT $3
            "#,
            schema::MISCONCEPTIONS
        ))
        .bind(course_id)
        .bind(cid)
        .bind(lim)
        .fetch_all(pool)
        .await;
    }
    if let Some(pat) = needle.as_ref() {
        return sqlx::query_as::<_, MisconceptionRow>(&format!(
            r#"
            SELECT id, course_id, concept_id, name, description, remediation_body, remediation_url,
                   locale, is_seed, created_at, updated_at
            FROM {}
            WHERE course_id = $1
              AND (lower(name) LIKE $2 OR lower(COALESCE(description, '')) LIKE $2)
            ORDER BY name ASC
            LIMIT $3
            "#,
            schema::MISCONCEPTIONS
        ))
        .bind(course_id)
        .bind(pat)
        .bind(lim)
        .fetch_all(pool)
        .await;
    }
    sqlx::query_as::<_, MisconceptionRow>(&format!(
        r#"
        SELECT id, course_id, concept_id, name, description, remediation_body, remediation_url,
               locale, is_seed, created_at, updated_at
        FROM {}
        WHERE course_id = $1
        ORDER BY name ASC
        LIMIT $2
        "#,
        schema::MISCONCEPTIONS
    ))
    .bind(course_id)
    .bind(lim)
    .fetch_all(pool)
    .await
}

pub async fn get_by_id(
    pool: &PgPool,
    course_id: Uuid,
    id: Uuid,
) -> Result<Option<MisconceptionRow>, sqlx::Error> {
    sqlx::query_as::<_, MisconceptionRow>(&format!(
        r#"
        SELECT id, course_id, concept_id, name, description, remediation_body, remediation_url,
               locale, is_seed, created_at, updated_at
        FROM {}
        WHERE id = $1 AND course_id = $2
        "#,
        schema::MISCONCEPTIONS
    ))
    .bind(id)
    .bind(course_id)
    .fetch_optional(pool)
    .await
}

pub async fn insert(
    pool: &PgPool,
    course_id: Uuid,
    concept_id: Option<Uuid>,
    name: &str,
    description: Option<&str>,
    remediation_body: Option<&str>,
    remediation_url: Option<&str>,
    locale: &str,
    is_seed: bool,
) -> Result<Uuid, sqlx::Error> {
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (
            course_id, concept_id, name, description, remediation_body, remediation_url, locale, is_seed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        "#,
        schema::MISCONCEPTIONS
    ))
    .bind(course_id)
    .bind(concept_id)
    .bind(name)
    .bind(description)
    .bind(remediation_body)
    .bind(remediation_url)
    .bind(locale)
    .bind(is_seed)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn update(
    pool: &PgPool,
    course_id: Uuid,
    id: Uuid,
    concept_id: Option<Uuid>,
    name: &str,
    description: Option<&str>,
    remediation_body: Option<&str>,
    remediation_url: Option<&str>,
    locale: &str,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET concept_id = $1, name = $2, description = $3, remediation_body = $4,
            remediation_url = $5, locale = $6, updated_at = NOW()
        WHERE id = $7 AND course_id = $8
        "#,
        schema::MISCONCEPTIONS
    ))
    .bind(concept_id)
    .bind(name)
    .bind(description)
    .bind(remediation_body)
    .bind(remediation_url)
    .bind(locale)
    .bind(id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_for_course(pool: &PgPool, course_id: Uuid, id: Uuid) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $1 AND course_id = $2"#,
        schema::MISCONCEPTIONS
    ))
    .bind(id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn upsert_option_tag<'e, E>(
    executor: &mut E,
    question_id: Uuid,
    option_id: Uuid,
    misconception_id: Uuid,
) -> Result<(), sqlx::Error>
where
    for<'a> &'a mut E: Executor<'a, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (question_id, option_id, misconception_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (question_id, option_id) DO UPDATE SET misconception_id = EXCLUDED.misconception_id
        "#,
        schema::QUESTION_OPTION_MISCONCEPTION_TAGS
    ))
    .bind(question_id)
    .bind(option_id)
    .bind(misconception_id)
    .execute(&mut *executor)
    .await?;
    Ok(())
}

pub async fn delete_option_tag<'e, E>(
    executor: &mut E,
    question_id: Uuid,
    option_id: Uuid,
) -> Result<(), sqlx::Error>
where
    for<'a> &'a mut E: Executor<'a, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE question_id = $1 AND option_id = $2"#,
        schema::QUESTION_OPTION_MISCONCEPTION_TAGS
    ))
    .bind(question_id)
    .bind(option_id)
    .execute(&mut *executor)
    .await?;
    Ok(())
}

pub async fn get_misconception_for_option(
    pool: &PgPool,
    course_id: Uuid,
    question_id: Uuid,
    option_id: Uuid,
) -> Result<Option<MisconceptionRow>, sqlx::Error> {
    sqlx::query_as::<_, MisconceptionRow>(&format!(
        r#"
        SELECT m.id, m.course_id, m.concept_id, m.name, m.description, m.remediation_body, m.remediation_url,
               m.locale, m.is_seed, m.created_at, m.updated_at
        FROM {} t
        INNER JOIN {} m ON m.id = t.misconception_id
        WHERE t.question_id = $1 AND t.option_id = $2 AND m.course_id = $3
        "#,
        schema::QUESTION_OPTION_MISCONCEPTION_TAGS,
        schema::MISCONCEPTIONS
    ))
    .bind(question_id)
    .bind(option_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await
}

pub async fn count_user_misconception_triggers(
    pool: &PgPool,
    user_id: Uuid,
    misconception_id: Uuid,
) -> Result<i64, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(&format!(
        r#"SELECT COUNT(*)::bigint FROM {} WHERE user_id = $1 AND misconception_id = $2"#,
        schema::MISCONCEPTION_EVENTS
    ))
    .bind(user_id)
    .bind(misconception_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn insert_event<'e, E>(
    executor: &mut E,
    course_id: Uuid,
    user_id: Uuid,
    attempt_id: Uuid,
    question_id: Uuid,
    misconception_id: Uuid,
    selected_option_id: Option<Uuid>,
    remediation_shown: bool,
) -> Result<Uuid, sqlx::Error>
where
    for<'a> &'a mut E: Executor<'a, Database = Postgres>,
{
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (
            course_id, user_id, attempt_id, question_id, misconception_id, selected_option_id, remediation_shown
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
        schema::MISCONCEPTION_EVENTS
    ))
    .bind(course_id)
    .bind(user_id)
    .bind(attempt_id)
    .bind(question_id)
    .bind(misconception_id)
    .bind(selected_option_id)
    .bind(remediation_shown)
    .fetch_one(&mut *executor)
    .await?;
    Ok(id)
}

pub async fn list_events_for_attempt(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Vec<(Uuid, MisconceptionRow, Option<Uuid>)>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct Ev {
        question_id: Uuid,
        selected_option_id: Option<Uuid>,
        misconception_id: Uuid,
        name: String,
        description: Option<String>,
        remediation_body: Option<String>,
        remediation_url: Option<String>,
        locale: String,
        is_seed: bool,
        m_course_id: Uuid,
        concept_id: Option<Uuid>,
        created_at: DateTime<Utc>,
        updated_at: DateTime<Utc>,
    }
    let rows = sqlx::query_as::<_, Ev>(&format!(
        r#"
        SELECT
            e.question_id,
            e.selected_option_id,
            m.id AS misconception_id,
            m.name,
            m.description,
            m.remediation_body,
            m.remediation_url,
            m.locale,
            m.is_seed,
            m.course_id AS m_course_id,
            m.concept_id,
            m.created_at,
            m.updated_at
        FROM {} e
        INNER JOIN {} m ON m.id = e.misconception_id
        WHERE e.attempt_id = $1
        "#,
        schema::MISCONCEPTION_EVENTS,
        schema::MISCONCEPTIONS
    ))
    .bind(attempt_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let m = MisconceptionRow {
                id: r.misconception_id,
                course_id: r.m_course_id,
                concept_id: r.concept_id,
                name: r.name,
                description: r.description,
                remediation_body: r.remediation_body,
                remediation_url: r.remediation_url,
                locale: r.locale,
                is_seed: r.is_seed,
                created_at: r.created_at,
                updated_at: r.updated_at,
            };
            (r.question_id, m, r.selected_option_id)
        })
        .collect())
}

pub async fn count_all_events_for_user_course(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
) -> Result<i64, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(&format!(
        r#"SELECT COUNT(*)::bigint FROM {} WHERE user_id = $1 AND course_id = $2"#,
        schema::MISCONCEPTION_EVENTS
    ))
    .bind(user_id)
    .bind(course_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn misconception_report(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<MisconceptionReportRow>, sqlx::Error> {
    sqlx::query_as::<_, MisconceptionReportRow>(&format!(
        r#"
        SELECT
            m.id AS misconception_id,
            m.name AS misconception_name,
            q.id AS question_id,
            LEFT(q.stem, 200) AS question_stem,
            COUNT(*)::bigint AS trigger_count,
            COUNT(DISTINCT e.user_id)::bigint AS affected_students,
            MIN(e.created_at) AS first_seen_at,
            MAX(e.created_at) AS last_seen_at
        FROM {} e
        INNER JOIN {} m ON m.id = e.misconception_id
        INNER JOIN {} q ON q.id = e.question_id
        WHERE e.course_id = $1
        GROUP BY m.id, m.name, q.id, q.stem
        ORDER BY trigger_count DESC, misconception_name ASC
        "#,
        schema::MISCONCEPTION_EVENTS,
        schema::MISCONCEPTIONS,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn list_recurring_for_user_course(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    min_triggers: i64,
) -> Result<Vec<MisconceptionSummaryRow>, sqlx::Error> {
    sqlx::query_as::<_, MisconceptionSummaryRow>(&format!(
        r#"
        SELECT m.id AS misconception_id, m.name, COUNT(*)::bigint AS trigger_count
        FROM {} e
        INNER JOIN {} m ON m.id = e.misconception_id
        WHERE e.user_id = $1 AND e.course_id = $2
        GROUP BY m.id, m.name
        HAVING COUNT(*) >= $3
        ORDER BY trigger_count DESC
        "#,
        schema::MISCONCEPTION_EVENTS,
        schema::MISCONCEPTIONS
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(min_triggers)
    .fetch_all(pool)
    .await
}
