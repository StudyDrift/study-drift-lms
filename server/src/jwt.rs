use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone)]
pub struct JwtSigner {
    secret: String,
    ttl: Duration,
}

#[derive(Deserialize, Serialize)]
struct Claims {
    sub: String,
    email: String,
    exp: usize,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub email: String,
}

impl JwtSigner {
    pub fn new(secret: &str) -> Self {
        Self {
            secret: secret.to_string(),
            ttl: Duration::hours(72),
        }
    }

    pub fn sign(&self, user_id: Uuid, email: &str) -> Result<String, jsonwebtoken::errors::Error> {
        let exp = Utc::now() + self.ttl;
        let claims = Claims {
            sub: user_id.to_string(),
            email: email.to_string(),
            exp: exp.timestamp() as usize,
        };
        let key = EncodingKey::from_secret(self.secret.as_bytes());
        encode(&Header::default(), &claims, &key)
    }

    pub fn verify(&self, token: &str) -> Result<AuthUser, jsonwebtoken::errors::Error> {
        let key = DecodingKey::from_secret(self.secret.as_bytes());
        let data = decode::<Claims>(token, &key, &Validation::default())?;
        let user_id = Uuid::parse_str(&data.claims.sub).map_err(|_| {
            jsonwebtoken::errors::Error::from(jsonwebtoken::errors::ErrorKind::InvalidToken)
        })?;
        Ok(AuthUser {
            user_id,
            email: data.claims.email,
        })
    }
}
