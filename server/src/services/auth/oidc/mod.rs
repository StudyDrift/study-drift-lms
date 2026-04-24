//! OpenID Connect Authorization Code with PKCE (plan 4.2).

mod apple;

use std::time::{Duration, Instant};

use base64::Engine as _;
use openidconnect::core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata};
use openidconnect::url::Url;
use openidconnect::{
    AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::jwt::JwtSigner;
use crate::models::auth::{AuthResponse, UserPublic};
use crate::repos::{oidc as oidc_repo, rbac, user};
use crate::services::auth::credentials::{hash_placeholder_password, normalize_email};
use crate::state::OidcState;

use self::apple::client_secret_jwt as apple_client_secret;

const CACHE_TTL: Duration = Duration::from_secs(3600);


/// Build redirect URL for a named path segment.
pub fn redirect_uri_for(public_base: &str, path_provider: &str) -> String {
    format!(
        "{}/auth/oidc/{}/callback",
        public_base.trim_end_matches('/'),
        path_provider
    )
}

fn random_token() -> String {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

fn sub_log_hash(s: &str) -> String {
    let d = Sha256::digest(s.as_bytes());
    hex::encode(&d[..8])
}

async fn discover_cached(
    oidc: &OidcState,
    issuer: IssuerUrl,
) -> Result<CoreProviderMetadata, AppError> {
    let key = issuer.to_string();
    {
        let cache = oidc.metadata_cache.lock().await;
        if let Some((t, m)) = cache.get(&key) {
            if t.elapsed() < CACHE_TTL {
                return Ok(m.clone());
            }
        }
    }
    let meta = CoreProviderMetadata::discover_async(issuer, &oidc.http)
        .await
        .map_err(|e| {
            tracing::warn!(target: "oidc", err = %e, "oidc discovery failed (no valid cache entry)");
            AppError::invalid_input("Could not contact the identity provider (OIDC discovery failed).")
        })?;
    let mut cache = oidc.metadata_cache.lock().await;
    cache.insert(key, (Instant::now(), meta.clone()));
    Ok(meta)
}

fn issuer_for_custom_discovery(discovery_url: &str) -> Result<IssuerUrl, AppError> {
    let t = discovery_url.trim();
    if t.ends_with("/.well-known/openid-configuration") {
        let base = t
            .strip_suffix("/.well-known/openid-configuration")
            .unwrap_or(t)
            .trim_end_matches('/');
        IssuerUrl::new(base.to_string())
            .map_err(|e| AppError::invalid_input(format!("Invalid custom discovery base URL: {e}")))
    } else {
        IssuerUrl::new(t.trim_end_matches('/').to_string())
            .map_err(|e| AppError::invalid_input(format!("Invalid custom issuer URL: {e}")))
    }
}

/// Returns the authorization URL for redirect.
pub async fn build_authorize_redirect_url(
    pool: &PgPool,
    oidc: &OidcState,
    path_provider: &str,
    custom_config: Option<oidc_repo::OidcProviderConfigRow>,
    link_id: Option<Uuid>,
    next_path: Option<&str>,
) -> Result<Url, AppError> {
    oidc_repo::delete_stale_flow_state(pool).await?;
    oidc_repo::delete_stale_link_intents(pool).await?;

    let mut for_user: Option<Uuid> = None;
    let custom_id = custom_config.as_ref().map(|c| c.id);
    if let Some(lid) = link_id {
        let intent = oidc_repo::take_link_intent(pool, lid)
            .await?
            .ok_or_else(|| AppError::invalid_input("Sign-in link expired or was already used."))?;
        if intent.1 != path_provider {
            return Err(AppError::invalid_input("This sign-in link is for a different provider."));
        }
        if path_provider == "custom" {
            let ccid = custom_config
                .as_ref()
                .map(|c| c.id)
                .ok_or_else(|| AppError::invalid_input("Missing custom configuration for this link."))?;
            if intent.2 != Some(ccid) {
                return Err(AppError::invalid_input("This sign-in link is for a different custom provider."));
            }
        } else if intent.2.is_some() {
            return Err(AppError::invalid_input("Invalid sign-in link."));
        }
        for_user = Some(intent.0);
    }

    let (issuer, client_id, secret_opt, hd_opt) = match path_provider {
        "google" => {
            let Some((ref cred, ref hd)) = oidc.google else {
                return Err(AppError::invalid_input("Google sign-in is not configured."));
            };
            let iss = IssuerUrl::new("https://accounts.google.com".to_string())
                .map_err(|e| AppError::invalid_input(format!("Invalid issuer: {e}")))?;
            (iss, cred.client_id.as_str(), Some(cred.client_secret.as_str()), hd.clone())
        }
        "microsoft" => {
            let Some((ref cred, ref tenant)) = oidc.microsoft else {
                return Err(AppError::invalid_input("Microsoft sign-in is not configured."));
            };
            let iss = IssuerUrl::new(format!(
                "https://login.microsoftonline.com/{}/v2.0",
                tenant.trim()
            ))
            .map_err(|e| AppError::invalid_input(format!("Invalid issuer: {e}")))?;
            (iss, cred.client_id.as_str(), Some(cred.client_secret.as_str()), None)
        }
        "apple" => {
            oidc
                .apple
                .as_ref()
                .ok_or_else(|| AppError::invalid_input("Apple sign-in is not configured."))?;
            let iss = IssuerUrl::new("https://appleid.apple.com".to_string())
                .map_err(|e| AppError::invalid_input(format!("Invalid issuer: {e}")))?;
            let cid = oidc.apple.as_ref().unwrap().client_id.as_str();
            (iss, cid, None, None)
        }
        "custom" => {
            let row = custom_config
                .as_ref()
                .ok_or_else(|| AppError::invalid_input("A custom OIDC configuration is required here."))?;
            let iss = issuer_for_custom_discovery(&row.discovery_url)?;
            (iss, row.client_id.as_str(), Some(row.client_secret.as_str()), row.hd_restriction.clone())
        }
        _ => return Err(AppError::invalid_input("Unknown OIDC provider.")),
    };

    let secret = match (path_provider, secret_opt) {
        ("apple", None) => None,
        (_, Some(s)) => Some(ClientSecret::new(s.to_string())),
        _ => {
            return Err(AppError::invalid_input("Missing OIDC client secret configuration."));
        }
    };

    let metadata = discover_cached(oidc, issuer).await?;
    let redirect = RedirectUrl::new(redirect_uri_for(&oidc.public_base, path_provider))
        .map_err(|e| AppError::invalid_input(format!("Invalid redirect: {e}")))?;

    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(client_id.to_string()),
        secret,
    )
    .set_redirect_uri(redirect);

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let state_str = random_token();
    let nonce_str = random_token();
    let st = state_str.clone();
    let nt = nonce_str.clone();
    let mut req = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            move || CsrfToken::new(st),
            move || Nonce::new(nt),
        )
        .add_scope(Scope::new("email".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .set_pkce_challenge(pkce_challenge);

    if path_provider == "google" {
        if let Some(ref d) = hd_opt {
            if !d.is_empty() {
                req = req.add_extra_param("hd", d);
            }
        }
    }

    let (url, _cs, _no) = req.url();
    oidc_repo::save_flow_state(
        pool,
        &state_str,
        &nonce_str,
        pkce_verifier.secret().as_str(),
        path_provider,
        custom_id,
        for_user,
        next_path,
    )
    .await?;
    Ok(url)
}

/// Complete OIDC callback: `code` and `state` from query; `path_provider` matches the route.
/// The optional second value is a safe in-app `next` path for the post-login redirect.
pub async fn complete_oidc_login(
    pool: &PgPool,
    oidc: &OidcState,
    jwt: &JwtSigner,
    path_provider: &str,
    code: &str,
    state: &str,
) -> Result<(AuthResponse, Option<String>), AppError> {
    oidc_repo::delete_stale_flow_state(pool).await?;

    let flow = oidc_repo::take_flow_state(pool, state)
        .await?
        .ok_or_else(|| {
            tracing::warn!(target: "oidc", "oidc.login_failed (bad or expired state — possible CSRF)");
            AppError::invalid_input("Sign-in could not be completed. Please start again from the login page.")
        })?;
    let next_path = flow.next_path.clone();
    if flow.provider != path_provider {
        tracing::warn!(target: "oidc", "oidc.login_failed (state provider mismatch, CSRF)");
        return Err(AppError::invalid_input("Invalid sign-in state. Please start again from the login page."));
    }

    let custom_row: Option<oidc_repo::OidcProviderConfigRow> = if let Some(cid) = flow.custom_config_id {
        Some(
            oidc_repo::get_custom_config(pool, cid)
                .await?
                .ok_or_else(|| AppError::invalid_input("The OIDC configuration no longer exists."))?,
        )
    } else {
        None
    };

    let (issuer, client_id, secret): (IssuerUrl, String, Option<ClientSecret>) = match path_provider
    {
        "google" => {
            let (cred, _) = oidc
                .google
                .as_ref()
                .ok_or_else(|| AppError::invalid_input("Google sign-in is not configured."))?;
            let iss = IssuerUrl::new("https://accounts.google.com".to_string())
                .map_err(|e| AppError::invalid_input(e.to_string()))?;
            (
                iss,
                cred.client_id.clone(),
                Some(ClientSecret::new(cred.client_secret.clone())),
            )
        }
        "microsoft" => {
            let (cred, tenant) = oidc
                .microsoft
                .as_ref()
                .ok_or_else(|| AppError::invalid_input("Microsoft sign-in is not configured."))?;
            let iss = IssuerUrl::new(format!(
                "https://login.microsoftonline.com/{}/v2.0",
                tenant.trim()
            ))
            .map_err(|e| AppError::invalid_input(e.to_string()))?;
            (
                iss,
                cred.client_id.clone(),
                Some(ClientSecret::new(cred.client_secret.clone())),
            )
        }
        "apple" => {
            let a = oidc
                .apple
                .as_ref()
                .ok_or_else(|| AppError::invalid_input("Apple sign-in is not configured."))?;
            let iss = IssuerUrl::new("https://appleid.apple.com".to_string())
                .map_err(|e| AppError::invalid_input(e.to_string()))?;
            (iss, a.client_id.clone(), Some(ClientSecret::new(apple_client_secret(a)?)))
        }
        "custom" => {
            let row = custom_row
                .as_ref()
                .ok_or_else(|| AppError::invalid_input("Missing custom OIDC configuration."))?;
            let iss = issuer_for_custom_discovery(&row.discovery_url)?;
            (
                iss,
                row.client_id.clone(),
                Some(ClientSecret::new(row.client_secret.clone())),
            )
        }
        _ => return Err(AppError::invalid_input("Unknown OIDC provider.")),
    };

    let secret = if path_provider == "apple" {
        let a = oidc
            .apple
            .as_ref()
            .ok_or_else(|| AppError::invalid_input("Apple sign-in is not configured."))?;
        Some(ClientSecret::new(apple_client_secret(a)?))
    } else {
        secret
    };

    let metadata = discover_cached(oidc, issuer).await?;
    let redirect = RedirectUrl::new(redirect_uri_for(&oidc.public_base, path_provider))
        .map_err(|e| AppError::invalid_input(e.to_string()))?;
    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(client_id),
        secret,
    )
    .set_redirect_uri(redirect.clone());
    let pkv = PkceCodeVerifier::new(flow.code_verifier);
    let code = AuthorizationCode::new(code.to_string());
    let token = client
        .exchange_code(code)
        .map_err(|e| AppError::invalid_input(e.to_string()))?
        .set_pkce_verifier(pkv)
        .request_async(&oidc.http)
        .await
        .map_err(|e| {
            tracing::warn!(target: "oidc", err = %e, "oidc.token_exchange_failed");
            AppError::invalid_input("Could not complete sign-in with the identity provider.")
        })?;

    let id_tok = token
        .id_token()
        .ok_or_else(|| AppError::invalid_input("The identity provider did not return an ID token."))?;
    let nonce = Nonce::new(flow.nonce);
    let idv = client.id_token_verifier();
    let claims = id_tok
        .claims(&idv, &nonce)
        .map_err(|e| AppError::invalid_input(format!("Invalid ID token: {e}")))?;

    if let Some(expected) = claims.access_token_hash() {
        let alg = id_tok.signing_alg().map_err(|e| {
            AppError::invalid_input(format!("ID token: {e}"))
        })?;
        let key = id_tok
            .signing_key(&idv)
            .map_err(|e| AppError::invalid_input(format!("ID token: {e}")))?;
        let actual = AccessTokenHash::from_token(token.access_token(), alg, key)
            .map_err(|e| AppError::invalid_input(format!("at_hash: {e}")))?;
        if actual != *expected {
            return Err(AppError::invalid_input(
                "Access token did not match ID token (at_hash).",
            ));
        }
    }

    let sub = claims.subject().to_string();
    let email_in = {
        let Some(ref em) = claims.email() else {
            return Err(AppError::invalid_input(
                "The identity provider did not return an email address.",
            ));
        };
        let n = normalize_email(em.as_str());
        if n.is_empty() || !n.contains('@') {
            return Err(AppError::invalid_input(
                "The identity provider did not return a usable email address.",
            ));
        }
        n
    };

    if path_provider == "google" {
        if let Some((_, mhd)) = &oidc.google {
            if let Some(want) = mhd {
                if !want.is_empty()
                    && !email_in.to_lowercase().ends_with(&format!("@{}", want.trim().to_lowercase()))
                {
                    return Err(AppError::invalid_input(
                        "Your account is not in the allowed Google Workspace domain for this app.",
                    ));
                }
            }
        }
    }
    if path_provider == "custom" {
        if let Some(ref row) = custom_row {
            if let Some(ref want) = row.hd_restriction {
                if !want.is_empty()
                    && !email_in
                        .to_lowercase()
                        .ends_with(&format!("@{}", want.trim().to_lowercase()))
                {
                    return Err(AppError::invalid_input(
                        "Your account is not in the allowed domain for this app.",
                    ));
                }
            }
        }
    }

    if let Some(idem) = oidc_repo::find_identity(pool, path_provider, &sub).await? {
        let u = user::find_by_id(pool, idem.user_id)
            .await?
            .ok_or_else(|| AppError::NotFound)?;
        tracing::info!(target: "oidc", provider = path_provider, sub_hash = %sub_log_hash(&sub), "oidc.login_success");
        return Ok((finish(jwt, u)?, next_path.clone()));
    }

    if let Some(uid) = flow.for_user_id {
        let u = user::find_by_id(pool, uid)
            .await?
            .ok_or_else(|| AppError::NotFound)?;
        if normalize_email(&u.email) != email_in {
            return Err(AppError::invalid_input(
                "The signed-in account email does not match the account you are connecting.",
            ));
        }
        oidc_repo::try_insert_identity(pool, u.id, path_provider, &sub, Some(&email_in))
            .await?;
        tracing::info!(target: "oidc", provider = path_provider, sub_hash = %sub_log_hash(&sub), "oidc.login_success");
        return Ok((finish(jwt, u)?, next_path.clone()));
    }

    if let Some(u) = user::find_by_email_ci(pool, &email_in).await? {
        oidc_repo::try_insert_identity(pool, u.id, path_provider, &sub, Some(&email_in))
            .await?;
        tracing::info!(target: "oidc", provider = path_provider, sub_hash = %sub_log_hash(&sub), "oidc.login_success");
        return Ok((finish(jwt, u)?, next_path.clone()));
    }

    let h = hash_placeholder_password()?;
    let disp: Option<String> = None;
    let u = user::insert_user(pool, &email_in, &h, disp.as_deref()).await?;
    oidc_repo::try_insert_identity(pool, u.id, path_provider, &sub, Some(&email_in))
        .await?;
    rbac::assign_user_role_by_name(pool, u.id, "Student").await?;
    tracing::info!(target: "oidc", provider = path_provider, sub_hash = %sub_log_hash(&sub), "oidc.login_success (jit)");
    Ok((finish(jwt, u)?, next_path))
}

fn finish(jwt: &JwtSigner, u: user::UserRow) -> Result<AuthResponse, AppError> {
    let access_token = jwt.sign(u.id, &u.email)?;
    Ok(AuthResponse {
        access_token,
        token_type: "Bearer".into(),
        user: UserPublic {
            id: u.id,
            email: u.email,
            display_name: u.display_name,
            first_name: u.first_name,
            last_name: u.last_name,
            avatar_url: u.avatar_url,
            ui_theme: u.ui_theme,
            sid: u.sid,
        },
    })
}

