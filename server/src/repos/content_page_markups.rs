use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::content_page_markups::ContentPageMarkupResponse;

const MAX_QUOTE_LEN: usize = 24_000;
const MAX_COMMENT_LEN: usize = 8_000;
const MAX_NOTEBOOK_PAGE_ID_LEN: usize = 128;

pub fn validate_markup_request(
    kind: &str,
    quote_text: &str,
    notebook_page_id: &Option<String>,
    comment_text: &Option<String>,
) -> Result<(), String> {
    if quote_text.is_empty() {
        return Err("quoteText must not be empty.".into());
    }
    if quote_text.len() > MAX_QUOTE_LEN {
        return Err("quoteText is too long.".into());
    }
    if let Some(c) = comment_text {
        if c.len() > MAX_COMMENT_LEN {
            return Err("commentText is too long.".into());
        }
    }
    if let Some(pid) = notebook_page_id {
        if pid.len() > MAX_NOTEBOOK_PAGE_ID_LEN {
            return Err("notebookPageId is too long.".into());
        }
    }
    match kind {
        "highlight" => {
            if notebook_page_id.is_some() || comment_text.is_some() {
                return Err("highlight must not include notebookPageId or commentText.".into());
            }
        }
        "note" => {
            if notebook_page_id
                .as_ref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
            {
                return Err("note requires notebookPageId.".into());
            }
        }
        _ => return Err("kind must be highlight or note.".into()),
    }
    Ok(())
}

pub async fn list_for_user_item(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    structure_item_id: Uuid,
) -> Result<Vec<ContentPageMarkupResponse>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MarkupRow>(
        r#"
        SELECT id, kind, quote_text, notebook_page_id, comment_text, created_at
        FROM course.content_page_user_markups
        WHERE user_id = $1 AND course_id = $2 AND structure_item_id = $3
        ORDER BY created_at ASC
        "#,
    )
    .bind(user_id)
    .bind(course_id)
    .bind(structure_item_id)
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
    structure_item_id: Uuid,
    structure_kind: &str,
    kind: &str,
    quote_text: &str,
    notebook_page_id: Option<&str>,
    comment_text: Option<&str>,
) -> Result<ContentPageMarkupResponse, sqlx::Error> {
    let row = sqlx::query_as::<_, MarkupRow>(
        r#"
        INSERT INTO course.content_page_user_markups (
            user_id, course_id, structure_item_id, kind, quote_text, notebook_page_id, comment_text
        )
        SELECT $1, $2, $3, $4, $5, $6, $7
        FROM course.course_structure_items si
        WHERE si.id = $3 AND si.course_id = $2 AND si.kind = $8
        RETURNING id, kind, quote_text, notebook_page_id, comment_text, created_at
        "#,
    )
    .bind(user_id)
    .bind(course_id)
    .bind(structure_item_id)
    .bind(kind)
    .bind(quote_text)
    .bind(notebook_page_id)
    .bind(comment_text)
    .bind(structure_kind)
    .fetch_optional(pool)
    .await?;

    let Some(r) = row else {
        return Err(sqlx::Error::RowNotFound);
    };

    Ok(ContentPageMarkupResponse {
        id: r.id,
        kind: r.kind,
        quote_text: r.quote_text,
        notebook_page_id: r.notebook_page_id,
        comment_text: r.comment_text,
        created_at: r.created_at,
    })
}

pub async fn delete_owned(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    structure_item_id: Uuid,
    markup_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(
        r#"
        DELETE FROM course.content_page_user_markups
        WHERE id = $1 AND user_id = $2 AND course_id = $3 AND structure_item_id = $4
        "#,
    )
    .bind(markup_id)
    .bind(user_id)
    .bind(course_id)
    .bind(structure_item_id)
    .execute(pool)
    .await?;

    Ok(res.rows_affected() > 0)
}
