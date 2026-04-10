use std::collections::HashMap;
use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::types::Json;
use sqlx::FromRow;
use sqlx::PgPool;
use sqlx::Postgres;
use sqlx::Transaction;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_module_quiz::QuizQuestion;

#[derive(Debug, FromRow)]
pub struct CourseItemQuizRow {
    pub title: String,
    pub markdown: String,
    pub due_at: Option<DateTime<Utc>>,
    pub questions_json: Json<Vec<QuizQuestion>>,
    pub updated_at: DateTime<Utc>,
    pub available_from: Option<DateTime<Utc>>,
    pub available_until: Option<DateTime<Utc>>,
    pub unlimited_attempts: bool,
    pub one_question_at_a_time: bool,
    pub is_adaptive: bool,
    pub adaptive_system_prompt: String,
    pub adaptive_source_item_ids: Json<Vec<Uuid>>,
    pub adaptive_question_count: i32,
}

pub async fn insert_empty_for_item(
    tx: &mut Transaction<'_, Postgres>,
    structure_item_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, markdown, questions_json, updated_at)
        VALUES ($1, '', '[]'::jsonb, NOW())
        "#,
        schema::MODULE_QUIZZES
    ))
    .bind(structure_item_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn get_for_course_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CourseItemQuizRow>, sqlx::Error> {
    let row: Option<CourseItemQuizRow> = sqlx::query_as(&format!(
        r#"
        SELECT c.title, m.markdown, c.due_at, m.questions_json, m.updated_at,
               m.available_from, m.available_until, m.unlimited_attempts, m.one_question_at_a_time,
               m.is_adaptive, m.adaptive_system_prompt, m.adaptive_source_item_ids, m.adaptive_question_count
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'quiz'
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_QUIZZES
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Markdown bodies for structure items (content pages, assignments, quiz intros), in course order of `ids`.
pub async fn reference_markdown_for_items(
    pool: &PgPool,
    course_id: Uuid,
    ids: &[Uuid],
) -> Result<String, sqlx::Error> {
    if ids.is_empty() {
        return Ok(String::new());
    }
    #[derive(FromRow)]
    struct RefRow {
        id: Uuid,
        title: String,
        kind: String,
        body: String,
    }
    let rows: Vec<RefRow> = sqlx::query_as(&format!(
        r#"
        SELECT
            c.id,
            c.title,
            c.kind,
            COALESCE(cp.markdown, asn.markdown, qz.markdown, '') AS body
        FROM {} c
        LEFT JOIN {} cp ON cp.structure_item_id = c.id AND c.kind = 'content_page'
        LEFT JOIN {} asn ON asn.structure_item_id = c.id AND c.kind = 'assignment'
        LEFT JOIN {} qz ON qz.structure_item_id = c.id AND c.kind = 'quiz'
        WHERE c.course_id = $1 AND c.id = ANY($2)
          AND c.kind IN ('content_page', 'assignment', 'quiz')
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_CONTENT_PAGES,
        schema::MODULE_ASSIGNMENTS,
        schema::MODULE_QUIZZES
    ))
    .bind(course_id)
    .bind(ids)
    .fetch_all(pool)
    .await?;

    let mut by_id: HashMap<Uuid, RefRow> = HashMap::with_capacity(rows.len());
    for r in rows {
        by_id.insert(r.id, r);
    }
    let mut blocks = Vec::new();
    for id in ids {
        if let Some(r) = by_id.get(id) {
            blocks.push(format!(
                "---\nItem: {} ({})\n{}\n",
                r.title,
                r.kind,
                r.body.trim()
            ));
        }
    }
    Ok(blocks.join("\n"))
}

pub async fn update_delivery_settings(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    available_from: Option<Option<DateTime<Utc>>>,
    available_until: Option<Option<DateTime<Utc>>>,
    unlimited_attempts: Option<bool>,
    one_question_at_a_time: Option<bool>,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    if available_from.is_none()
        && available_until.is_none()
        && unlimited_attempts.is_none()
        && one_question_at_a_time.is_none()
    {
        return Ok(None);
    }

    let cur: Option<(Option<DateTime<Utc>>, Option<DateTime<Utc>>, bool, bool)> = sqlx::query_as(&format!(
        r#"
        SELECT m.available_from, m.available_until, m.unlimited_attempts, m.one_question_at_a_time
        FROM {} m
        INNER JOIN {} c ON m.structure_item_id = c.id
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'quiz'
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;

    let Some((caf, cau, cua, coq)) = cur else {
        return Ok(None);
    };

    let n_af = match available_from {
        None => caf,
        Some(v) => v,
    };
    let n_au = match available_until {
        None => cau,
        Some(v) => v,
    };
    let n_ua = unlimited_attempts.unwrap_or(cua);
    let n_oq = one_question_at_a_time.unwrap_or(coq);

    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET available_from = $3,
            available_until = $4,
            unlimited_attempts = $5,
            one_question_at_a_time = $6,
            updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'quiz'
        RETURNING m.updated_at
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(n_af)
    .bind(n_au)
    .bind(n_ua)
    .bind(n_oq)
    .fetch_optional(pool)
    .await
}

pub async fn update_title(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    title: &str,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        WITH c_up AS (
            UPDATE {}
            SET title = $3, updated_at = NOW()
            WHERE id = $1 AND course_id = $2 AND kind = 'quiz'
            RETURNING id
        )
        UPDATE {} m
        SET updated_at = NOW()
        FROM c_up
        WHERE m.structure_item_id = c_up.id
        RETURNING m.updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_QUIZZES
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(title)
    .fetch_optional(pool)
    .await
}

pub async fn update_markdown(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET markdown = $3, updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'quiz'
        RETURNING m.updated_at
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .fetch_optional(pool)
    .await
}

pub async fn update_adaptive_config(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    is_adaptive: bool,
    adaptive_system_prompt: &str,
    adaptive_source_item_ids: &[Uuid],
    adaptive_question_count: i32,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET is_adaptive = $3,
            adaptive_system_prompt = $4,
            adaptive_source_item_ids = $5::jsonb,
            adaptive_question_count = $6,
            updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'quiz'
        RETURNING m.updated_at
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(is_adaptive)
    .bind(adaptive_system_prompt)
    .bind(Json(adaptive_source_item_ids.to_vec()))
    .bind(adaptive_question_count)
    .fetch_optional(pool)
    .await
}

pub async fn update_questions(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    questions: &[QuizQuestion],
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET questions_json = $3, updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'quiz'
        RETURNING m.updated_at
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(Json(questions.to_vec()))
    .fetch_optional(pool)
    .await
}

pub async fn upsert_import_body(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
    questions: &[QuizQuestion],
    available_from: Option<DateTime<Utc>>,
    available_until: Option<DateTime<Utc>>,
    unlimited_attempts: bool,
    one_question_at_a_time: bool,
    is_adaptive: bool,
    adaptive_system_prompt: &str,
    adaptive_source_item_ids: &[Uuid],
    adaptive_question_count: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            structure_item_id, markdown, questions_json, updated_at,
            available_from, available_until, unlimited_attempts, one_question_at_a_time,
            is_adaptive, adaptive_system_prompt, adaptive_source_item_ids, adaptive_question_count
        )
        SELECT c.id, $3, $4::jsonb, NOW(), $5, $6, $7, $8, $9, $10, $11::jsonb, $12
        FROM {} c
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'quiz'
        ON CONFLICT (structure_item_id) DO UPDATE SET
            markdown = EXCLUDED.markdown,
            questions_json = EXCLUDED.questions_json,
            updated_at = NOW(),
            available_from = EXCLUDED.available_from,
            available_until = EXCLUDED.available_until,
            unlimited_attempts = EXCLUDED.unlimited_attempts,
            one_question_at_a_time = EXCLUDED.one_question_at_a_time,
            is_adaptive = EXCLUDED.is_adaptive,
            adaptive_system_prompt = EXCLUDED.adaptive_system_prompt,
            adaptive_source_item_ids = EXCLUDED.adaptive_source_item_ids,
            adaptive_question_count = EXCLUDED.adaptive_question_count
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .bind(Json(questions.to_vec()))
    .bind(available_from)
    .bind(available_until)
    .bind(unlimited_attempts)
    .bind(one_question_at_a_time)
    .bind(is_adaptive)
    .bind(adaptive_system_prompt)
    .bind(Json(adaptive_source_item_ids.to_vec()))
    .bind(adaptive_question_count)
    .execute(pool)
    .await?;
    Ok(())
}
