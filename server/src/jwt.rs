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

#[derive(Debug, Serialize, Deserialize)]
struct LtiEmbedTicketClaims {
    /// Discriminator so embed tickets cannot be confused with login JWTs.
    #[serde(rename = "ltiEmbed")]
    lti_embed: bool,
    sub: String,
    course_id: String,
    item_id: String,
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

    /// Short-lived HMAC token used to open the LTI consumer embed iframe without a Bearer header.
    pub fn sign_lti_embed_ticket(
        &self,
        user_id: Uuid,
        course_id: Uuid,
        item_id: Uuid,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let exp = (Utc::now() + Duration::minutes(15)).timestamp() as usize;
        let claims = LtiEmbedTicketClaims {
            lti_embed: true,
            sub: user_id.to_string(),
            course_id: course_id.to_string(),
            item_id: item_id.to_string(),
            exp,
        };
        let key = EncodingKey::from_secret(self.secret.as_bytes());
        encode(&Header::default(), &claims, &key)
    }

    pub fn verify_lti_embed_ticket(
        &self,
        token: &str,
    ) -> Result<(Uuid, Uuid, Uuid), jsonwebtoken::errors::Error> {
        let key = DecodingKey::from_secret(self.secret.as_bytes());
        let data = decode::<LtiEmbedTicketClaims>(token, &key, &Validation::default())?;
        if !data.claims.lti_embed {
            return Err(jsonwebtoken::errors::Error::from(
                jsonwebtoken::errors::ErrorKind::InvalidToken,
            ));
        }
        let user_id = Uuid::parse_str(&data.claims.sub).map_err(|_| {
            jsonwebtoken::errors::Error::from(jsonwebtoken::errors::ErrorKind::InvalidToken)
        })?;
        let course_id = Uuid::parse_str(&data.claims.course_id).map_err(|_| {
            jsonwebtoken::errors::Error::from(jsonwebtoken::errors::ErrorKind::InvalidToken)
        })?;
        let item_id = Uuid::parse_str(&data.claims.item_id).map_err(|_| {
            jsonwebtoken::errors::Error::from(jsonwebtoken::errors::ErrorKind::InvalidToken)
        })?;
        Ok((user_id, course_id, item_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn sign_verify_round_trip() {
        let signer = JwtSigner::new("unit-test-secret");
        let id = Uuid::new_v4();
        let tok = signer.sign(id, "a@b.com").unwrap();
        let u = signer.verify(&tok).unwrap();
        assert_eq!(u.user_id, id);
        assert_eq!(u.email, "a@b.com");
    }

    #[test]
    fn wrong_secret_fails_verify() {
        let a = JwtSigner::new("secret-a");
        let b = JwtSigner::new("secret-b");
        let id = Uuid::new_v4();
        let tok = a.sign(id, "x@y.z").unwrap();
        assert!(b.verify(&tok).is_err());
    }
}
