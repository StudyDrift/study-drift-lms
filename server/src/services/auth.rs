use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::Engine as _;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::jwt::JwtSigner;
use crate::models::auth::{
    AuthResponse, ForgotPasswordRequest, ForgotPasswordResponse, LoginRequest, ResetPasswordRequest,
    ResetPasswordResponse, SignupRequest, UserPublic,
};
use crate::repos::{communication, password_reset, rbac, user};
use crate::services::mail;
use crate::state::MailSettings;

fn hash_password(raw: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(raw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| AppError::invalid_input("Could not process password."))
}

/// Argon2 hash of a long random secret for accounts created without a known password (e.g. roster import).
pub fn hash_placeholder_password() -> Result<String, AppError> {
    let secret = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    hash_password(&secret)
}

fn verify_password(raw: &str, stored: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored) else {
        return false;
    };
    Argon2::default()
        .verify_password(raw.as_bytes(), &parsed)
        .is_ok()
}

pub fn normalize_email(s: &str) -> String {
    s.trim().to_lowercase()
}

fn validate_signup(req: &SignupRequest) -> Result<(), AppError> {
    let email = normalize_email(&req.email);
    if email.is_empty() || !email.contains('@') || email.len() > 254 {
        return Err(AppError::invalid_input(
            "Enter a valid email address.",
        ));
    }
    if req.password.len() < 8 {
        return Err(AppError::invalid_input(
            "Password must be at least 8 characters.",
        ));
    }
    Ok(())
}

fn validate_login(req: &LoginRequest) -> Result<(), AppError> {
    if req.email.trim().is_empty() || req.password.is_empty() {
        return Err(AppError::invalid_input(
            "Email and password are required.",
        ));
    }
    Ok(())
}

pub async fn signup(
    pool: &PgPool,
    jwt: &JwtSigner,
    req: SignupRequest,
) -> Result<AuthResponse, AppError> {
    validate_signup(&req)?;
    let email = normalize_email(&req.email);
    let password_hash = hash_password(&req.password)?;
    let display_name = req
        .display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let row = match user::insert_user(pool, &email, &password_hash, display_name).await {
        Ok(row) => row,
        Err(e) => {
            if let sqlx::Error::Database(ref db) = e {
                if db.code().as_deref() == Some("23505") {
                    return Err(AppError::EmailTaken);
                }
            }
            return Err(e.into());
        }
    };

    let access_token = jwt.sign(row.id, &row.email)?;
    rbac::assign_user_role_by_name(pool, row.id, "Teacher").await?;

    if let Err(e) = communication::send_welcome_message(pool, &email).await {
        tracing::warn!(
            error = %e,
            user_id = %row.id,
            "could not create welcome inbox message"
        );
    }

    Ok(AuthResponse {
        access_token,
        token_type: "Bearer".into(),
        user: UserPublic {
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            first_name: row.first_name,
            last_name: row.last_name,
            avatar_url: row.avatar_url,
            ui_theme: row.ui_theme,
            sid: row.sid,
        },
    })
}

pub async fn login(
    pool: &PgPool,
    jwt: &JwtSigner,
    req: LoginRequest,
) -> Result<AuthResponse, AppError> {
    validate_login(&req)?;
    let email = normalize_email(&req.email);
    let Some(row) = user::find_by_email(pool, &email).await? else {
        return Err(AppError::InvalidCredentials);
    };
    if !verify_password(&req.password, &row.password_hash) {
        return Err(AppError::InvalidCredentials);
    }

    let access_token = jwt.sign(row.id, &row.email)?;
    Ok(AuthResponse {
        access_token,
        token_type: "Bearer".into(),
        user: UserPublic {
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            first_name: row.first_name,
            last_name: row.last_name,
            avatar_url: row.avatar_url,
            ui_theme: row.ui_theme,
            sid: row.sid,
        },
    })
}

fn sha256_token(token: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    h.finalize().into()
}

pub async fn request_password_reset(
    pool: &PgPool,
    mail_settings: &MailSettings,
    public_web_origin: &str,
    req: ForgotPasswordRequest,
) -> Result<ForgotPasswordResponse, AppError> {
    let email = normalize_email(&req.email);
    if email.is_empty() || !email.contains('@') || email.len() > 254 {
        return Err(AppError::invalid_input(
            "Enter a valid email address.",
        ));
    }

    if let Some(row) = user::find_by_email(pool, &email).await? {
        let mut raw = [0u8; 32];
        OsRng.fill_bytes(&mut raw);
        let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
        let token_hash = sha256_token(&token);
        let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);
        password_reset::replace_token_for_user(pool, row.id, &token_hash, expires_at).await?;

        let origin = public_web_origin.trim_end_matches('/');
        let reset_url = format!("{origin}/reset-password?token={token}");

        if let Err(e) = mail::send_password_reset_email(mail_settings, &row.email, &reset_url).await
        {
            tracing::error!(
                error = %e,
                email = %row.email,
                "failed to send password reset email"
            );
        }
    }

    Ok(ForgotPasswordResponse {
        message: "If that email is registered, you will receive a reset link shortly.",
    })
}

pub async fn reset_password(
    pool: &PgPool,
    req: ResetPasswordRequest,
) -> Result<ResetPasswordResponse, AppError> {
    let token = req.token.trim();
    if token.is_empty() {
        return Err(AppError::InvalidResetToken);
    }
    if req.password.len() < 8 {
        return Err(AppError::invalid_input(
            "Password must be at least 8 characters.",
        ));
    }

    let token_hash = sha256_token(token);
    let Some(row) = password_reset::find_by_token_hash(pool, &token_hash).await? else {
        return Err(AppError::InvalidResetToken);
    };
    if row.used_at.is_some() {
        return Err(AppError::InvalidResetToken);
    }
    if row.expires_at < chrono::Utc::now() {
        return Err(AppError::InvalidResetToken);
    }

    let password_hash = hash_password(&req.password)?;
    let ok =
        password_reset::mark_used_and_set_password(pool, row.id, row.user_id, &password_hash)
            .await?;
    if !ok {
        return Err(AppError::InvalidResetToken);
    }

    Ok(ResetPasswordResponse {
        message: "Your password has been updated. You can sign in now.",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_email_trims_and_lowercases() {
        assert_eq!(normalize_email("  A@B.COM  "), "a@b.com");
    }

    #[test]
    fn sha256_token_is_stable() {
        let a = sha256_token("hello");
        let b = sha256_token("hello");
        assert_eq!(a, b);
        assert_ne!(a, sha256_token("hello!"));
    }
}
