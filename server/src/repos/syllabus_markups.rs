use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::content_page_markups::ContentPageMarkupResponse;

pub async fn list_for_user_course(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
) -> Result<Vec<ContentPageMarkupResponse>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MarkupRow>(
        r#"
        SELECT id, kind, quote_text, notebook_page_id, comment_text, created_at
        FROM course.syllabus_user_markups
        WHERE user_id = $1 AND course_id = $2
        ORDER BY created_at ASC
        "#,
    )
    .bind(user_id)
    .bind(course_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| ContentPageMarkupResponse {
            id: r.id,
            kind: r.kind,
            quote_text: r.quote_text,
            notebook_page_id: r.notebook_page_id,
            comment_text: r.comment_text,
            created_at: r.created_at,
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct MarkupRow {
    id: Uuid,
    kind: String,
    quote_text: String,
    notebook_page_id: Option<String>,
    comment_text: Option<String>,
    created_at: DateTime<Utc>,
}

pub async fn insert(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    kind: &str,
    quote_text: &str,
    notebook_page_id: Option<&str>,
    comment_text: Option<&str>,
) -> Result<ContentPageMarkupResponse, sqlx::Error> {
    let row = sqlx::query_as::<_, MarkupRow>(
        r#"
        INSERT INTO course.syllabus_user_markups (
            user_id, course_id, kind, quote_text, notebook_page_id, comment_text
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, kind, quote_text, notebook_page_id, comment_text, created_at
        "#,
    )
    .bind(user_id)
    .bind(course_id)
    .bind(kind)
    .bind(quote_text)
    .bind(notebook_page_id)
    .bind(comment_text)
    .fetch_one(pool)
    .await?;

    Ok(ContentPageMarkupResponse {
        id: row.id,
        kind: row.kind,
        quote_text: row.quote_text,
        notebook_page_id: row.notebook_page_id,
        comment_text: row.comment_text,
        created_at: row.created_at,
    })
}

pub async fn delete_owned(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    markup_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(
        r#"
        DELETE FROM course.syllabus_user_markups
        WHERE id = $1 AND user_id = $2 AND course_id = $3
        "#,
    )
    .bind(markup_id)
    .bind(user_id)
    .bind(course_id)
    .execute(pool)
    .await?;

    Ok(res.rows_affected() > 0)
}
