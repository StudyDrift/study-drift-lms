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
    pub report_storage_key: Option<String>,
    pub snapshot_storage_key: Option<String>,
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
               report_url, report_token, provider_report_id, error_message,
               report_storage_key, snapshot_storage_key, created_at, updated_at
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

/// FERPA / DSAR: originality rows for all submissions by a user (across courses).
pub async fn list_for_user_ferpa(
    pool: &PgPool,
    submitted_by: Uuid,
) -> Result<Vec<OriginalityReportFerpaRow>, sqlx::Error> {
    sqlx::query_as::<_, OriginalityReportFerpaRow>(
        r#"
        SELECT r.id AS report_id, r.submission_id, r.provider, r.status, r.similarity_pct, r.ai_probability,
               r.updated_at, c.course_code, s.module_item_id, s.submitted_by
        FROM course.originality_reports r
        INNER JOIN course.module_assignment_submissions s ON s.id = r.submission_id
        INNER JOIN course.courses c ON c.id = s.course_id
        WHERE s.submitted_by = $1
        ORDER BY r.updated_at ASC
        "#,
    )
    .bind(submitted_by)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OriginalityReportFerpaRow {
    pub report_id: Uuid,
    pub submission_id: Uuid,
    pub provider: String,
    pub status: String,
    pub similarity_pct: Option<Decimal>,
    pub ai_probability: Option<Decimal>,
    pub updated_at: DateTime<Utc>,
    pub course_code: String,
    pub module_item_id: Uuid,
    pub submitted_by: Uuid,
}

/// Storage path cleanup before submission row deletion.
pub async fn list_storage_key_pairs_for_submission(
    pool: &PgPool,
    submission_id: Uuid,
) -> Result<Vec<(Option<String>, Option<String>)>, sqlx::Error> {
    let rows: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT report_storage_key, snapshot_storage_key
        FROM course.originality_reports
        WHERE submission_id = $1
        "#,
    )
    .bind(submission_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
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
) -> Result<Uuid, sqlx::Error> {
    let id: Uuid = sqlx::query_scalar(&format!(
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
        RETURNING id
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
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn set_storage_keys(
    pool: &PgPool,
    report_id: Uuid,
    report_storage_key: &str,
    snapshot_storage_key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET report_storage_key = $2, snapshot_storage_key = $3, updated_at = NOW()
        WHERE id = $1
        "#,
        schema::ORIGINALITY_REPORTS
    ))
    .bind(report_id)
    .bind(report_storage_key)
    .bind(snapshot_storage_key)
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

/// Update external report matched by provider_report_id (webhook completion). Returns (report_id, submission_id) rows updated.
pub async fn mark_done_by_provider_report(
    pool: &PgPool,
    provider: &str,
    provider_report_id: &str,
    similarity_pct: Option<Decimal>,
    report_url: Option<&str>,
    report_token: Option<&str>,
) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        &format!(
            r#"
            UPDATE {}
            SET status = 'done',
                similarity_pct = COALESCE($2, similarity_pct),
                report_url = COALESCE($3, report_url),
                report_token = COALESCE($4, report_token),
                error_message = NULL,
                updated_at = NOW()
            WHERE provider = $1 AND provider_report_id = $5
            RETURNING id, submission_id
            "#,
            schema::ORIGINALITY_REPORTS
        )
    )
    .bind(provider)
    .bind(similarity_pct)
    .bind(report_url)
    .bind(report_token)
    .bind(provider_report_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
