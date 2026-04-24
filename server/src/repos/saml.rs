use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SamlIdpConfigRow {
    pub id: Uuid,
    pub institution_id: Option<Uuid>,
    pub display_name: String,
    pub entity_id: String,
    pub sso_url: String,
    pub slo_url: Option<String>,
    pub idp_cert_pem: String,
    pub attribute_mapping: Value,
    pub force_saml: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn get_idp_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<SamlIdpConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, SamlIdpConfigRow>(&format!(
        r#"
        SELECT
            id, institution_id, display_name, entity_id, sso_url, slo_url,
            idp_cert_pem, attribute_mapping, force_saml, created_at, updated_at
        FROM {}
        WHERE id = $1
        "#,
        schema::SAML_IDP_CONFIGURATIONS
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// First registered IdP (for single-tenant / default SSO button).
pub async fn get_default_idp(pool: &PgPool) -> Result<Option<SamlIdpConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, SamlIdpConfigRow>(&format!(
        r#"
        SELECT
            id, institution_id, display_name, entity_id, sso_url, slo_url,
            idp_cert_pem, attribute_mapping, force_saml, created_at, updated_at
        FROM {}
        ORDER BY created_at ASC
        LIMIT 1
        "#,
        schema::SAML_IDP_CONFIGURATIONS
    ))
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Default)]
pub struct SamlIdpConfigWrite {
    pub institution_id: Option<Uuid>,
    pub display_name: String,
    pub entity_id: String,
    pub sso_url: String,
    pub slo_url: Option<String>,
    pub idp_cert_pem: String,
    pub attribute_mapping: Value,
    pub force_saml: bool,
}

/// When `id` is some, update that row. Otherwise update the first row by `created_at`, or insert if the table is empty.
pub async fn upsert_idp(
    pool: &PgPool,
    id: Option<Uuid>,
    w: &SamlIdpConfigWrite,
) -> Result<SamlIdpConfigRow, sqlx::Error> {
    if let Some(eid) = id {
        let row = sqlx::query_as::<_, SamlIdpConfigRow>(&format!(
            r#"
            UPDATE {}
            SET
                institution_id = $2,
                display_name = $3,
                entity_id = $4,
                sso_url = $5,
                slo_url = $6,
                idp_cert_pem = $7,
                attribute_mapping = $8,
                force_saml = $9,
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id, institution_id, display_name, entity_id, sso_url, slo_url,
                idp_cert_pem, attribute_mapping, force_saml, created_at, updated_at
            "#,
            schema::SAML_IDP_CONFIGURATIONS
        ))
        .bind(eid)
        .bind(w.institution_id)
        .bind(&w.display_name)
        .bind(&w.entity_id)
        .bind(&w.sso_url)
        .bind(&w.slo_url)
        .bind(&w.idp_cert_pem)
        .bind(&w.attribute_mapping)
        .bind(w.force_saml)
        .fetch_optional(pool)
        .await?;
        if let Some(r) = row {
            return Ok(r);
        }
    }

    let first = sqlx::query_scalar::<_, Option<Uuid>>(&format!(
        r#"SELECT id FROM {} ORDER BY created_at ASC LIMIT 1"#,
        schema::SAML_IDP_CONFIGURATIONS
    ))
    .fetch_one(pool)
    .await?;

    if let Some(eid) = first {
        return sqlx::query_as::<_, SamlIdpConfigRow>(&format!(
            r#"
            UPDATE {}
            SET
                institution_id = $2,
                display_name = $3,
                entity_id = $4,
                sso_url = $5,
                slo_url = $6,
                idp_cert_pem = $7,
                attribute_mapping = $8,
                force_saml = $9,
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id, institution_id, display_name, entity_id, sso_url, slo_url,
                idp_cert_pem, attribute_mapping, force_saml, created_at, updated_at
            "#,
            schema::SAML_IDP_CONFIGURATIONS
        ))
        .bind(eid)
        .bind(w.institution_id)
        .bind(&w.display_name)
        .bind(&w.entity_id)
        .bind(&w.sso_url)
        .bind(&w.slo_url)
        .bind(&w.idp_cert_pem)
        .bind(&w.attribute_mapping)
        .bind(w.force_saml)
        .fetch_one(pool)
        .await;
    }

    sqlx::query_as::<_, SamlIdpConfigRow>(&format!(
        r#"
        INSERT INTO {}
            (institution_id, display_name, entity_id, sso_url, slo_url, idp_cert_pem, attribute_mapping, force_saml)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING
            id, institution_id, display_name, entity_id, sso_url, slo_url,
            idp_cert_pem, attribute_mapping, force_saml, created_at, updated_at
        "#,
        schema::SAML_IDP_CONFIGURATIONS
    ))
    .bind(w.institution_id)
    .bind(&w.display_name)
    .bind(&w.entity_id)
    .bind(&w.sso_url)
    .bind(&w.slo_url)
    .bind(&w.idp_cert_pem)
    .bind(&w.attribute_mapping)
    .bind(w.force_saml)
    .fetch_one(pool)
    .await
}

pub async fn save_authn_state(
    pool: &PgPool,
    request_id: &str,
    idp_id: Uuid,
    relay_state: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (request_id, idp_id, relay_state)
        VALUES ($1, $2, $3)
        ON CONFLICT (request_id) DO UPDATE SET
            idp_id = EXCLUDED.idp_id,
            relay_state = EXCLUDED.relay_state,
            created_at = NOW()
        "#,
        schema::SAML_AUTHN_REQUEST_STATE
    ))
    .bind(request_id)
    .bind(idp_id)
    .bind(relay_state)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn take_authn_state(
    pool: &PgPool,
    request_id: &str,
) -> Result<Option<(Uuid, Option<String>)>, sqlx::Error> {
    let row: Option<(Uuid, Option<String>)> = sqlx::query_as(&format!(
        r#"
        DELETE FROM {}
        WHERE request_id = $1
        RETURNING idp_id, relay_state
        "#,
        schema::SAML_AUTHN_REQUEST_STATE
    ))
    .bind(request_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn record_replay(
    pool: &PgPool,
    correlation_id: &str,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        INSERT INTO {} (correlation_id) VALUES ($1)
        ON CONFLICT (correlation_id) DO NOTHING
        "#,
        schema::SAML_REPLAY_GUARD
    ))
    .bind(correlation_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn delete_stale_authn_state(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE created_at < NOW() - INTERVAL '15 minutes'
        "#,
        schema::SAML_AUTHN_REQUEST_STATE
    ))
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n)
}

pub async fn delete_stale_replay_guard(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE created_at < NOW() - INTERVAL '24 hours'
        "#,
        schema::SAML_REPLAY_GUARD
    ))
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n)
}
