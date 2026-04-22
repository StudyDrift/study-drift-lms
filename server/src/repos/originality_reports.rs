use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OriginalityReportRow {
    pub id: Uuid,
    pub submission_id: Uuid,
    pub provider: String,
    pub status: String,
    pub similarity_pct: Option<Decimal>,
    pub ai_probability: Option<Decimal>,
    pub report_url: Option<String>,
    pub report_token: Option<String>,
    pub provider_report_id: Option<String>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_for_submission(
    pool: &PgPool,
    submission_id: Uuid,
) -> Result<Vec<OriginalityReportRow>, sqlx::Error> {
    sqlx::query_as::<_, OriginalityReportRow>(&format!(
        r#"
        SELECT id, submission_id, provider, status, similarity_pct, ai_probability,
               report_url, report_token, provider_report_id, error_message, created_at, updated_at
        FROM {}
        WHERE submission_id = $1
        ORDER BY provider ASC
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(submission_id)
    .fetch_all(pool)
    .await
}

pub async fn insert_pending_if_missing(
    pool: &PgPool,
    submission_id: Uuid,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (submission_id, provider, status)
        VALUES ($1, $2, 'pending')
        ON CONFLICT (submission_id, provider) DO NOTHING
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(submission_id)
    .bind(provider)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_provider_report_id(
    pool: &PgPool,
    submission_id: Uuid,
    provider: &str,
    provider_report_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET provider_report_id = $3, updated_at = NOW()
        WHERE submission_id = $1 AND provider = $2
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(submission_id)
    .bind(provider)
    .bind(provider_report_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_processing(
    pool: &PgPool,
    submission_id: Uuid,
    provider: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'processing', updated_at = NOW()
        WHERE submission_id = $1 AND provider = $2 AND status IN ('pending', 'processing')
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(submission_id)
    .bind(provider)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_done(
    pool: &PgPool,
    submission_id: Uuid,
    provider: &str,
    similarity_pct: Option<Decimal>,
    ai_probability: Option<Decimal>,
    report_url: Option<&str>,
    report_token: Option<&str>,
    provider_report_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'done',
            similarity_pct = $3,
            ai_probability = $4,
            report_url = $5,
            report_token = $6,
            provider_report_id = $7,
            error_message = NULL,
            updated_at = NOW()
        WHERE submission_id = $1 AND provider = $2
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(submission_id)
    .bind(provider)
    .bind(similarity_pct)
    .bind(ai_probability)
    .bind(report_url)
    .bind(report_token)
    .bind(provider_report_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_failed(
    pool: &PgPool,
    submission_id: Uuid,
    provider: &str,
    message: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'failed', error_message = $3, updated_at = NOW()
        WHERE submission_id = $1 AND provider = $2
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(submission_id)
    .bind(provider)
    .bind(message)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_skipped(
    pool: &PgPool,
    submission_id: Uuid,
    provider: &str,
    message: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'skipped', error_message = $3, updated_at = NOW()
        WHERE submission_id = $1 AND provider = $2
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(submission_id)
    .bind(provider)
    .bind(message)
    .execute(pool)
    .await?;
    Ok(())
}

/// Update external report matched by provider_report_id (webhook completion).
pub async fn mark_done_by_provider_report(
    pool: &PgPool,
    provider: &str,
    provider_report_id: &str,
    similarity_pct: Option<Decimal>,
    report_url: Option<&str>,
    report_token: Option<&str>,
) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'done',
            similarity_pct = COALESCE($2, similarity_pct),
            report_url = COALESCE($3, report_url),
            report_token = COALESCE($4, report_token),
            error_message = NULL,
            updated_at = NOW()
        WHERE provider = $1 AND provider_report_id = $5
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(provider)
    .bind(similarity_pct)
    .bind(report_url)
    .bind(report_token)
    .bind(provider_report_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}
