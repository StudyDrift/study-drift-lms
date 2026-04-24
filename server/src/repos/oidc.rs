//! OIDC flow state, identities, and custom provider config (plan 4.2).

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, sqlx::FromRow)]
pub struct OidcFlowRow {
    pub nonce: String,
    pub code_verifier: String,
    pub provider: String,
    pub custom_config_id: Option<Uuid>,
    pub for_user_id: Option<Uuid>,
    pub next_path: Option<String>,
}

pub async fn delete_stale_flow_state(pool: &PgPool) -> Result<(), sqlx::Error> {
    let cutoff = Utc::now() - chrono::Duration::minutes(10);
    sqlx::query(&format!("DELETE FROM {} WHERE created_at < $1", schema::OIDC_FLOW_STATE))
        .bind(cutoff)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn save_flow_state(
    pool: &PgPool,
    state: &str,
    nonce: &str,
    code_verifier: &str,
    provider: &str,
    custom_config_id: Option<Uuid>,
    for_user_id: Option<Uuid>,
    next_path: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (state, nonce, code_verifier, provider, custom_config_id, for_user_id, next_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        schema::OIDC_FLOW_STATE
    ))
    .bind(state)
    .bind(nonce)
    .bind(code_verifier)
    .bind(provider)
    .bind(custom_config_id)
    .bind(for_user_id)
    .bind(next_path)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn take_flow_state(
    pool: &PgPool,
    state: &str,
) -> Result<Option<OidcFlowRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, OidcFlowRow>(&format!(
        r#"
        DELETE FROM {}
        WHERE state = $1
        RETURNING nonce, code_verifier, provider, custom_config_id, for_user_id, next_path
        "#,
        schema::OIDC_FLOW_STATE
    ))
    .bind(state)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

#[derive(Debug, sqlx::FromRow)]
pub struct OidcIdentityRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub provider: String,
    pub sub: String,
    pub email: Option<String>,
}

pub async fn find_identity(
    pool: &PgPool,
    provider: &str,
    sub: &str,
) -> Result<Option<OidcIdentityRow>, sqlx::Error> {
    sqlx::query_as::<_, OidcIdentityRow>(&format!(
        r#"
        SELECT id, user_id, provider, sub, email
        FROM {}
        WHERE provider = $1 AND sub = $2
        "#,
        schema::USER_OIDC_IDENTITIES
    ))
    .bind(provider)
    .bind(sub)
    .fetch_optional(pool)
    .await
}

/// Inserts a new `(provider, sub)` link; if it already exists, does nothing.
pub async fn try_insert_identity(
    pool: &PgPool,
    user_id: Uuid,
    provider: &str,
    sub: &str,
    email: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, provider, sub, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (provider, sub) DO NOTHING
        "#,
        schema::USER_OIDC_IDENTITIES
    ))
    .bind(user_id)
    .bind(provider)
    .bind(sub)
    .bind(email)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n > 0)
}

pub async fn list_identities_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<OidcIdentityRow>, sqlx::Error> {
    sqlx::query_as::<_, OidcIdentityRow>(&format!(
        r#"
        SELECT id, user_id, provider, sub, email
        FROM {}
        WHERE user_id = $1
        ORDER BY provider
        "#,
        schema::USER_OIDC_IDENTITIES
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn delete_identity(
    pool: &PgPool,
    user_id: Uuid,
    provider: &str,
) -> Result<bool, sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE user_id = $1 AND provider = $2"#,
        schema::USER_OIDC_IDENTITIES
    ))
    .bind(user_id)
    .bind(provider)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n > 0)
}

pub async fn delete_identity_by_id_for_user(
    pool: &PgPool,
    user_id: Uuid,
    identity_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $1 AND user_id = $2"#,
        schema::USER_OIDC_IDENTITIES
    ))
    .bind(identity_id)
    .bind(user_id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n > 0)
}

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct OidcProviderConfigRow {
    pub id: Uuid,
    pub institution_id: Option<Uuid>,
    pub display_name: String,
    pub client_id: String,
    pub client_secret: String,
    pub discovery_url: String,
    pub hd_restriction: Option<String>,
    pub attribute_mapping: Value,
}

pub async fn get_custom_config(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<OidcProviderConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, OidcProviderConfigRow>(&format!(
        r#"
        SELECT id, institution_id, display_name, client_id, client_secret, discovery_url, hd_restriction, attribute_mapping
        FROM {}
        WHERE id = $1
        "#,
        schema::OIDC_PROVIDER_CONFIGURATIONS
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn list_custom_configs(
    pool: &PgPool,
) -> Result<Vec<OidcProviderConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, OidcProviderConfigRow>(&format!(
        r#"
        SELECT id, institution_id, display_name, client_id, client_secret, discovery_url, hd_restriction, attribute_mapping
        FROM {}
        ORDER BY display_name
        "#,
        schema::OIDC_PROVIDER_CONFIGURATIONS
    ))
    .fetch_all(pool)
    .await
}

pub struct OidcProviderConfigWrite {
    pub institution_id: Option<Uuid>,
    pub display_name: String,
    pub client_id: String,
    pub client_secret: String,
    pub discovery_url: String,
    pub hd_restriction: Option<String>,
    pub attribute_mapping: Value,
}

pub async fn upsert_custom_config(
    pool: &PgPool,
    id: Option<Uuid>,
    w: &OidcProviderConfigWrite,
) -> Result<Uuid, sqlx::Error> {
    if let Some(existing) = id {
        sqlx::query(&format!(
            r#"
            UPDATE {}
            SET institution_id = $2, display_name = $3, client_id = $4, client_secret = $5, discovery_url = $6, hd_restriction = $7, attribute_mapping = $8, updated_at = NOW()
            WHERE id = $1
            "#,
            schema::OIDC_PROVIDER_CONFIGURATIONS
        ))
        .bind(existing)
        .bind(w.institution_id)
        .bind(&w.display_name)
        .bind(&w.client_id)
        .bind(&w.client_secret)
        .bind(&w.discovery_url)
        .bind(&w.hd_restriction)
        .bind(&w.attribute_mapping)
        .execute(pool)
        .await?;
        return Ok(existing);
    }
    let row: (Uuid,) = sqlx::query_as(&format!(
        r#"
        INSERT INTO {} (institution_id, display_name, client_id, client_secret, discovery_url, hd_restriction, attribute_mapping)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
        schema::OIDC_PROVIDER_CONFIGURATIONS
    ))
    .bind(w.institution_id)
    .bind(&w.display_name)
    .bind(&w.client_id)
    .bind(&w.client_secret)
    .bind(&w.discovery_url)
    .bind(&w.hd_restriction)
    .bind(&w.attribute_mapping)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn insert_link_intent(
    pool: &PgPool,
    user_id: Uuid,
    provider: &str,
    custom_config_id: Option<Uuid>,
) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::new_v4();
    let expires = Utc::now() + chrono::Duration::minutes(10);
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (id, user_id, provider, custom_config_id, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
        schema::OIDC_LINK_INTENTS
    ))
    .bind(id)
    .bind(user_id)
    .bind(provider)
    .bind(custom_config_id)
    .bind(expires)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn take_link_intent(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<(Uuid, String, Option<Uuid>)>, sqlx::Error> {
    let row: Option<(Uuid, String, Option<Uuid>, DateTime<Utc>)> = sqlx::query_as(&format!(
        r#"
        DELETE FROM {}
        WHERE id = $1 AND expires_at > NOW()
        RETURNING user_id, provider, custom_config_id, expires_at
        "#,
        schema::OIDC_LINK_INTENTS
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(uid, p, c, _)| (uid, p, c)))
}

pub async fn delete_stale_link_intents(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(&format!("DELETE FROM {} WHERE expires_at < NOW()", schema::OIDC_LINK_INTENTS))
        .execute(pool)
        .await?;
    Ok(())
}
