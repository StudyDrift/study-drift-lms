//! Persistence for LTI 1.3 registrations, OIDC state, nonces, and course resource links.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LtiPlatformRegistrationRow {
    pub id: Uuid,
    pub name: String,
    pub client_id: String,
    pub platform_iss: String,
    pub platform_jwks_url: String,
    pub platform_auth_url: String,
    pub platform_token_url: String,
    pub tool_redirect_uris: Vec<String>,
    pub deployment_ids: Vec<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LtiExternalToolRow {
    pub id: Uuid,
    pub name: String,
    pub client_id: String,
    pub tool_issuer: String,
    pub tool_jwks_url: String,
    pub tool_oidc_auth_url: String,
    pub tool_token_url: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LtiResourceLinkRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub structure_item_id: Uuid,
    pub external_tool_id: Uuid,
    pub resource_link_id: String,
    pub title: Option<String>,
    pub custom_params: Json<Value>,
    pub line_item_url: Option<String>,
}

pub async fn find_platform_registration(
    pool: &PgPool,
    iss: &str,
    client_id: &str,
) -> Result<Option<LtiPlatformRegistrationRow>, sqlx::Error> {
    sqlx::query_as::<_, LtiPlatformRegistrationRow>(&format!(
        r#"
        SELECT id, name, client_id, platform_iss, platform_jwks_url, platform_auth_url,
               platform_token_url, tool_redirect_uris, deployment_ids, active
        FROM {}
        WHERE platform_iss = $1 AND client_id = $2 AND active = true
        "#,
        schema::LTI_REGISTRATIONS
    ))
    .bind(iss)
    .bind(client_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_platform_registrations(
    pool: &PgPool,
) -> Result<Vec<LtiPlatformRegistrationRow>, sqlx::Error> {
    sqlx::query_as::<_, LtiPlatformRegistrationRow>(&format!(
        r#"
        SELECT id, name, client_id, platform_iss, platform_jwks_url, platform_auth_url,
               platform_token_url, tool_redirect_uris, deployment_ids, active
        FROM {}
        ORDER BY created_at DESC
        "#,
        schema::LTI_REGISTRATIONS
    ))
    .fetch_all(pool)
    .await
}

pub async fn insert_platform_registration(
    pool: &PgPool,
    name: &str,
    client_id: &str,
    platform_iss: &str,
    platform_jwks_url: &str,
    platform_auth_url: &str,
    platform_token_url: &str,
    tool_redirect_uris: &[String],
    deployment_ids: &[String],
) -> Result<Uuid, sqlx::Error> {
    let id: (Uuid,) = sqlx::query_as(&format!(
        r#"
        INSERT INTO {} (
            name, client_id, platform_iss, platform_jwks_url, platform_auth_url, platform_token_url,
            tool_redirect_uris, deployment_ids
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        "#,
        schema::LTI_REGISTRATIONS
    ))
    .bind(name)
    .bind(client_id)
    .bind(platform_iss)
    .bind(platform_jwks_url)
    .bind(platform_auth_url)
    .bind(platform_token_url)
    .bind(tool_redirect_uris)
    .bind(deployment_ids)
    .fetch_one(pool)
    .await?;
    Ok(id.0)
}

pub async fn update_platform_registration_active(
    pool: &PgPool,
    id: Uuid,
    active: bool,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"UPDATE {} SET active = $2 WHERE id = $1"#,
        schema::LTI_REGISTRATIONS
    ))
    .bind(id)
    .bind(active)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_platform_registration(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $1"#,
        schema::LTI_REGISTRATIONS
    ))
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn list_external_tools(pool: &PgPool) -> Result<Vec<LtiExternalToolRow>, sqlx::Error> {
    sqlx::query_as::<_, LtiExternalToolRow>(&format!(
        r#"
        SELECT id, name, client_id, tool_issuer, tool_jwks_url, tool_oidc_auth_url, tool_token_url, active
        FROM {}
        ORDER BY created_at DESC
        "#,
        schema::LTI_EXTERNAL_TOOLS
    ))
    .fetch_all(pool)
    .await
}

pub async fn get_external_tool(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<LtiExternalToolRow>, sqlx::Error> {
    sqlx::query_as::<_, LtiExternalToolRow>(&format!(
        r#"
        SELECT id, name, client_id, tool_issuer, tool_jwks_url, tool_oidc_auth_url, tool_token_url, active
        FROM {}
        WHERE id = $1
        "#,
        schema::LTI_EXTERNAL_TOOLS
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn insert_external_tool(
    pool: &PgPool,
    name: &str,
    client_id: &str,
    tool_issuer: &str,
    tool_jwks_url: &str,
    tool_oidc_auth_url: &str,
    tool_token_url: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    let id: (Uuid,) = sqlx::query_as(&format!(
        r#"
        INSERT INTO {} (name, client_id, tool_issuer, tool_jwks_url, tool_oidc_auth_url, tool_token_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
        schema::LTI_EXTERNAL_TOOLS
    ))
    .bind(name)
    .bind(client_id)
    .bind(tool_issuer)
    .bind(tool_jwks_url)
    .bind(tool_oidc_auth_url)
    .bind(tool_token_url)
    .fetch_one(pool)
    .await?;
    Ok(id.0)
}

pub async fn update_external_tool_active(
    pool: &PgPool,
    id: Uuid,
    active: bool,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"UPDATE {} SET active = $2 WHERE id = $1"#,
        schema::LTI_EXTERNAL_TOOLS
    ))
    .bind(id)
    .bind(active)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_external_tool(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $1"#,
        schema::LTI_EXTERNAL_TOOLS
    ))
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn insert_oidc_state(
    pool: &PgPool,
    state: &str,
    issuer: &str,
    client_id: &str,
    nonce: &str,
    target_link_uri: &str,
    login_hint: Option<&str>,
    deployment_id: Option<&str>,
    message_hint: Option<&str>,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (state, issuer, client_id, nonce, target_link_uri, login_hint, deployment_id, message_hint, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
        schema::LTI_OIDC_STATES
    ))
    .bind(state)
    .bind(issuer)
    .bind(client_id)
    .bind(nonce)
    .bind(target_link_uri)
    .bind(login_hint)
    .bind(deployment_id)
    .bind(message_hint)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn take_oidc_state(
    pool: &PgPool,
    state: &str,
) -> Result<
    Option<(
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    )>,
    sqlx::Error,
> {
    sqlx::query_as(&format!(
        r#"
        DELETE FROM {}
        WHERE state = $1 AND expires_at > NOW()
        RETURNING issuer, client_id, nonce, target_link_uri, login_hint, deployment_id, message_hint
        "#,
        schema::LTI_OIDC_STATES
    ))
    .bind(state)
    .fetch_optional(pool)
    .await
}

/// Returns `false` when the nonce was already present and still valid (replay).
pub async fn try_insert_consumed_nonce(
    pool: &PgPool,
    nonce: &str,
    expires_at: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE expires_at < NOW()"#,
        schema::LTI_NONCES
    ))
    .execute(pool)
    .await?;

    let res = sqlx::query(&format!(
        r#"
        INSERT INTO {} (nonce, expires_at) VALUES ($1, $2)
        ON CONFLICT (nonce) DO NOTHING
        "#,
        schema::LTI_NONCES
    ))
    .bind(nonce)
    .bind(expires_at)
    .execute(pool)
    .await?;

    if res.rows_affected() > 0 {
        return Ok(true);
    }

    let still: Option<(DateTime<Utc>,)> = sqlx::query_as(&format!(
        r#"SELECT expires_at FROM {} WHERE nonce = $1"#,
        schema::LTI_NONCES
    ))
    .bind(nonce)
    .fetch_optional(pool)
    .await?;

    if let Some((exp,)) = still {
        if exp > Utc::now() {
            return Ok(false);
        }
        sqlx::query(&format!(
            r#"DELETE FROM {} WHERE nonce = $1"#,
            schema::LTI_NONCES
        ))
        .bind(nonce)
        .execute(pool)
        .await?;
        sqlx::query(&format!(
            r#"INSERT INTO {} (nonce, expires_at) VALUES ($1, $2)"#,
            schema::LTI_NONCES
        ))
        .bind(nonce)
        .bind(expires_at)
        .execute(pool)
        .await?;
        return Ok(true);
    }
    Ok(true)
}

pub async fn upsert_lti_platform_account(
    pool: &PgPool,
    platform_iss: &str,
    platform_user_sub: &str,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (platform_iss, platform_user_sub, user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (platform_iss, platform_user_sub) DO NOTHING
        "#,
        schema::LTI_PLATFORM_ACCOUNTS
    ))
    .bind(platform_iss)
    .bind(platform_user_sub)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn find_user_for_platform_subject(
    pool: &PgPool,
    platform_iss: &str,
    platform_user_sub: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"SELECT user_id FROM {} WHERE platform_iss = $1 AND platform_user_sub = $2"#,
        schema::LTI_PLATFORM_ACCOUNTS
    ))
    .bind(platform_iss)
    .bind(platform_user_sub)
    .fetch_optional(pool)
    .await
}

pub async fn insert_resource_link(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
    external_tool_id: Uuid,
    resource_link_id: &str,
    title: Option<&str>,
    line_item_url: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    let id: (Uuid,) = sqlx::query_as(&format!(
        r#"
        INSERT INTO {} (course_id, structure_item_id, external_tool_id, resource_link_id, title, line_item_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
        schema::LTI_RESOURCE_LINKS
    ))
    .bind(course_id)
    .bind(structure_item_id)
    .bind(external_tool_id)
    .bind(resource_link_id)
    .bind(title)
    .bind(line_item_url)
    .fetch_one(pool)
    .await?;
    Ok(id.0)
}

pub async fn get_resource_link_for_structure_item(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
) -> Result<Option<LtiResourceLinkRow>, sqlx::Error> {
    sqlx::query_as::<_, LtiResourceLinkRow>(&format!(
        r#"
        SELECT id, course_id, structure_item_id, external_tool_id, resource_link_id, title, custom_params, line_item_url
        FROM {}
        WHERE course_id = $1 AND structure_item_id = $2
        "#,
        schema::LTI_RESOURCE_LINKS
    ))
    .bind(course_id)
    .bind(structure_item_id)
    .fetch_optional(pool)
    .await
}

pub async fn find_resource_link_by_line_item_url(
    pool: &PgPool,
    line_item_url: &str,
) -> Result<Option<LtiResourceLinkRow>, sqlx::Error> {
    sqlx::query_as::<_, LtiResourceLinkRow>(&format!(
        r#"
        SELECT id, course_id, structure_item_id, external_tool_id, resource_link_id, title, custom_params, line_item_url
        FROM {}
        WHERE line_item_url = $1
        "#,
        schema::LTI_RESOURCE_LINKS
    ))
    .bind(line_item_url)
    .fetch_optional(pool)
    .await
}

pub async fn update_resource_link_line_item(
    pool: &PgPool,
    structure_item_id: Uuid,
    line_item_url: &str,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"UPDATE {} SET line_item_url = $2 WHERE structure_item_id = $1"#,
        schema::LTI_RESOURCE_LINKS
    ))
    .bind(structure_item_id)
    .bind(line_item_url)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn update_resource_link_fields(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
    resource_link_id: Option<&str>,
    line_item_url: Option<&str>,
    title: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET
            resource_link_id = COALESCE($3, resource_link_id),
            line_item_url = COALESCE($4, line_item_url),
            title = COALESCE($5, title)
        WHERE course_id = $1 AND structure_item_id = $2
        "#,
        schema::LTI_RESOURCE_LINKS
    ))
    .bind(course_id)
    .bind(structure_item_id)
    .bind(resource_link_id)
    .bind(line_item_url)
    .bind(title)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}
