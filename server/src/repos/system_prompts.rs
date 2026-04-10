use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

pub struct SystemPromptRow {
    pub key: String,
    pub label: String,
    pub content: String,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_all(pool: &PgPool) -> Result<Vec<SystemPromptRow>, sqlx::Error> {
    let rows: Vec<(String, String, String, DateTime<Utc>)> = sqlx::query_as(&format!(
        r#"
        SELECT key, label, content, updated_at
        FROM {}
        ORDER BY key ASC
        "#,
        schema::SETTINGS_SYSTEM_PROMPTS
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(key, label, content, updated_at)| SystemPromptRow {
            key,
            label,
            content,
            updated_at,
        })
        .collect())
}

pub async fn get_content_by_key(pool: &PgPool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as(&format!(
        r#"SELECT content FROM {} WHERE key = $1"#,
        schema::SETTINGS_SYSTEM_PROMPTS
    ))
    .bind(key)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

pub async fn update_system_prompt(
    pool: &PgPool,
    key: &str,
    content: &str,
    user_id: Uuid,
) -> Result<SystemPromptRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let row: Option<(String, String, String, DateTime<Utc>)> = sqlx::query_as(&format!(
        r#"
        UPDATE {}
        SET content = $1, updated_at = NOW()
        WHERE key = $2
        RETURNING key, label, content, updated_at
        "#,
        schema::SETTINGS_SYSTEM_PROMPTS
    ))
    .bind(content)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((k, label, content, updated_at)) = row else {
        tx.rollback().await?;
        return Err(sqlx::Error::RowNotFound);
    };

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (prompt_key, content, saved_by_user_id, saved_at)
        VALUES ($1, $2, $3, NOW())
        "#,
        schema::SETTINGS_SYSTEM_PROMPTS_AUDIT
    ))
    .bind(key)
    .bind(content.clone())
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(SystemPromptRow {
        key: k,
        label,
        content,
        updated_at,
    })
}
