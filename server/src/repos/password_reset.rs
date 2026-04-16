use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, sqlx::FromRow)]
pub struct PasswordResetTokenRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: Vec<u8>,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
}

/// Removes outstanding reset tokens for this user, then inserts a new one.
pub async fn replace_token_for_user(
    pool: &PgPool,
    user_id: Uuid,
    token_hash: &[u8],
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE user_id = $1"#,
        schema::PASSWORD_RESET_TOKENS
    ))
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        "#,
        schema::PASSWORD_RESET_TOKENS
    ))
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn find_by_token_hash(
    pool: &PgPool,
    token_hash: &[u8],
) -> Result<Option<PasswordResetTokenRow>, sqlx::Error> {
    sqlx::query_as::<_, PasswordResetTokenRow>(&format!(
        r#"
        SELECT id, user_id, token_hash, expires_at, used_at
        FROM {}
        WHERE token_hash = $1
        "#,
        schema::PASSWORD_RESET_TOKENS
    ))
    .bind(token_hash)
    .fetch_optional(pool)
    .await
}

pub async fn mark_used_and_set_password(
    pool: &PgPool,
    token_id: Uuid,
    user_id: Uuid,
    password_hash: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let n = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET used_at = NOW()
        WHERE id = $1 AND user_id = $2 AND used_at IS NULL
        "#,
        schema::PASSWORD_RESET_TOKENS
    ))
    .bind(token_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n != 1 {
        tx.rollback().await?;
        return Ok(false);
    }

    sqlx::query(&format!(
        r#"UPDATE {} SET password_hash = $2 WHERE id = $1"#,
        schema::USERS
    ))
    .bind(user_id)
    .bind(password_hash)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(true)
}
