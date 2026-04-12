use std::collections::HashMap;
use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::Postgres;
use sqlx::Transaction;
use uuid::Uuid;

use crate::db::schema;
use crate::error::AppError;

const MAX_EXTERNAL_URL_LEN: usize = 2048;

pub fn validate_external_http_url(raw: &str) -> Result<String, AppError> {
    let s = raw.trim();
    if s.is_empty() {
        return Err(AppError::InvalidInput("URL is required.".into()));
    }
    if s.len() > MAX_EXTERNAL_URL_LEN {
        return Err(AppError::InvalidInput(format!(
            "URL must be at most {MAX_EXTERNAL_URL_LEN} characters."
        )));
    }
    let lower = s.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err(AppError::InvalidInput(
            "URL must start with http:// or https://.".into(),
        ));
    }
    if lower.starts_with("javascript:") || lower.starts_with("data:") {
        return Err(AppError::InvalidInput("Invalid URL.".into()));
    }
    Ok(s.to_string())
}

pub async fn insert_empty_for_item(
    tx: &mut Transaction<'_, Postgres>,
    structure_item_id: Uuid,
    url: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, url, updated_at)
        VALUES ($1, $2, NOW())
        "#,
        schema::MODULE_EXTERNAL_LINKS
    ))
    .bind(structure_item_id)
    .bind(url)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn upsert_import_body(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
    url: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, url, updated_at)
        SELECT $2, $3, NOW()
        FROM {} c
        WHERE c.id = $2 AND c.course_id = $1 AND c.kind = 'external_link'
        ON CONFLICT (structure_item_id) DO UPDATE SET
            url = EXCLUDED.url,
            updated_at = NOW()
        "#,
        schema::MODULE_EXTERNAL_LINKS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(structure_item_id)
    .bind(url)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn urls_for_structure_items(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_ids: &[Uuid],
) -> Result<HashMap<Uuid, String>, sqlx::Error> {
    if structure_item_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(Uuid, String)> = sqlx::query_as(&format!(
        r#"
        SELECT c.id, m.url
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.course_id = $1 AND c.kind = 'external_link' AND c.id = ANY($2)
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_EXTERNAL_LINKS
    ))
    .bind(course_id)
    .bind(structure_item_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

pub async fn get_for_course_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<(String, String, DateTime<Utc>)>, sqlx::Error> {
    let row: Option<(String, String, DateTime<Utc>)> = sqlx::query_as(&format!(
        r#"
        SELECT c.title, m.url, m.updated_at
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'external_link'
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_EXTERNAL_LINKS
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn update_url(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    url: &str,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    let updated: Option<(DateTime<Utc>,)> = sqlx::query_as(&format!(
        r#"
        UPDATE {} m
        SET url = $3, updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'external_link'
        RETURNING m.updated_at
        "#,
        schema::MODULE_EXTERNAL_LINKS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(url)
    .fetch_optional(pool)
    .await?;
    Ok(updated.map(|t| t.0))
}
