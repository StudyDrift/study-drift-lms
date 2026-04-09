use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::rngs::OsRng;
use sqlx::PgPool;

use crate::error::AppError;
use crate::jwt::JwtSigner;
use crate::models::auth::{AuthResponse, LoginRequest, SignupRequest, UserPublic};
use crate::repos::{communication, rbac, user};

fn hash_password(raw: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(raw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| AppError::InvalidInput("Could not process password.".into()))
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
        return Err(AppError::InvalidInput(
            "Enter a valid email address.".into(),
        ));
    }
    if req.password.len() < 8 {
        return Err(AppError::InvalidInput(
            "Password must be at least 8 characters.".into(),
        ));
    }
    Ok(())
}

fn validate_login(req: &LoginRequest) -> Result<(), AppError> {
    if req.email.trim().is_empty() || req.password.is_empty() {
        return Err(AppError::InvalidInput(
            "Email and password are required.".into(),
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
    rbac::assign_user_role_by_name(pool, row.id, "Student").await?;

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
        },
    })
}
