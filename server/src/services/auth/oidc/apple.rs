//! Apple Sign in — dynamic `client_secret` (JWT, ES256) per [Apple docs](https://developer.apple.com/documentation/signinwithapple/generate_and_validate_tokens).

use chrono::Utc;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::Serialize;

use crate::error::AppError;
use crate::state::AppleOidcCreds;

#[derive(Serialize)]
struct AppleSecretClaims<'a> {
    iss: &'a str,
    iat: i64,
    exp: i64,
    aud: &'static str,
    sub: &'a str,
}

/// Short-lived client secret (JWT) for the token request.
pub fn client_secret_jwt(c: &AppleOidcCreds) -> Result<String, AppError> {
    let iat = Utc::now().timestamp();
    let exp = iat + 60 * 10; // 10 minutes; Apple allows up to 6 months
    let claims = AppleSecretClaims {
        iss: c.team_id.as_str(),
        iat,
        exp,
        aud: "https://appleid.apple.com",
        sub: c.client_id.as_str(),
    };
    let mut h = Header::new(Algorithm::ES256);
    h.kid = Some(c.key_id.clone());
    let key = EncodingKey::from_ec_pem(c.private_key_pem.as_bytes()).map_err(|_| {
        AppError::invalid_input("OIDC_APPLE_PRIVATE_KEY_PEM is not a valid EC private key.")
    })?;
    encode(&h, &claims, &key).map_err(|_| {
        AppError::invalid_input("Could not sign Apple OIDC client secret JWT.")
    })
}
