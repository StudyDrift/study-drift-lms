use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OriginalityPlatformConfigRow {
    pub id: i16,
    pub dpa_accepted_at: Option<DateTime<Utc>>,
    pub active_external_provider: String,
    pub provider_api_key: Option<String>,
    pub webhook_hmac_secret: Option<String>,
    pub similarity_amber_min_pct: Decimal,
    pub similarity_red_min_pct: Decimal,
    pub ai_amber_min_pct: Decimal,
    pub ai_red_min_pct: Decimal,
    pub updated_at: DateTime<Utc>,
}

pub async fn get_singleton(pool: &PgPool) -> Result<OriginalityPlatformConfigRow, sqlx::Error> {
    sqlx::query_as::<_, OriginalityPlatformConfigRow>(&format!(
        r#"
        SELECT id, dpa_accepted_at, active_external_provider, provider_api_key, webhook_hmac_secret,
               similarity_amber_min_pct, similarity_red_min_pct, ai_amber_min_pct, ai_red_min_pct, updated_at
        FROM {}
        WHERE id = 1
        "#,
        schema::ORIGINALITY_PLATFORM_CONFIG
    ))
    .fetch_one(pool)
    .await
}

#[derive(Debug, Clone)]
pub struct OriginalityPlatformConfigWrite {
    pub dpa_accepted_at: Option<DateTime<Utc>>,
    pub active_external_provider: String,
    pub provider_api_key: Option<String>,
    pub webhook_hmac_secret: Option<String>,
    pub similarity_amber_min_pct: Decimal,
    pub similarity_red_min_pct: Decimal,
    pub ai_amber_min_pct: Decimal,
    pub ai_red_min_pct: Decimal,
}

pub async fn upsert_singleton(
    pool: &PgPool,
    w: &OriginalityPlatformConfigWrite,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            id, dpa_accepted_at, active_external_provider, provider_api_key, webhook_hmac_secret,
            similarity_amber_min_pct, similarity_red_min_pct, ai_amber_min_pct, ai_red_min_pct, updated_at
        )
        VALUES (
            1, $1, $2, $3, $4, $5, $6, $7, $8, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            dpa_accepted_at = EXCLUDED.dpa_accepted_at,
            active_external_provider = EXCLUDED.active_external_provider,
            provider_api_key = EXCLUDED.provider_api_key,
            webhook_hmac_secret = EXCLUDED.webhook_hmac_secret,
            similarity_amber_min_pct = EXCLUDED.similarity_amber_min_pct,
            similarity_red_min_pct = EXCLUDED.similarity_red_min_pct,
            ai_amber_min_pct = EXCLUDED.ai_amber_min_pct,
            ai_red_min_pct = EXCLUDED.ai_red_min_pct,
            updated_at = NOW()
        "#,
        schema::ORIGINALITY_PLATFORM_CONFIG
    ))
    .bind(w.dpa_accepted_at)
    .bind(&w.active_external_provider)
    .bind(&w.provider_api_key)
    .bind(&w.webhook_hmac_secret)
    .bind(w.similarity_amber_min_pct)
    .bind(w.similarity_red_min_pct)
    .bind(w.ai_amber_min_pct)
    .bind(w.ai_red_min_pct)
    .execute(pool)
    .await?;
    Ok(())
}
