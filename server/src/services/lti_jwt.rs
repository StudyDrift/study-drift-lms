//! JWKS fetch (with TTL cache) and RS256 verification helpers for LTI 1.3 ID tokens.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use rsa::pkcs8::EncodePublicKey;
use rsa::BigUint;
use serde::Deserialize;
use serde_json::Value;
use std::sync::OnceLock;

use crate::error::AppError;

static JWKS_HTTP: OnceLock<reqwest::Client> = OnceLock::new();

fn jwks_http() -> &'static reqwest::Client {
    JWKS_HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .build()
            .expect("jwks http client")
    })
}

const JWKS_CACHE_TTL: Duration = Duration::from_secs(15 * 60);

struct CachedJwks {
    fetched_at: Instant,
    /// PKCS#8 SPKI DER per `kid`.
    keys_by_kid: HashMap<String, Vec<u8>>,
}

static JWKS_CACHE: std::sync::OnceLock<Mutex<HashMap<String, CachedJwks>>> =
    std::sync::OnceLock::new();

fn jwks_cache() -> &'static Mutex<HashMap<String, CachedJwks>> {
    JWKS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
struct JwksDocument {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kid: Option<String>,
    kty: String,
    #[serde(rename = "use")]
    use_: Option<String>,
    #[allow(dead_code)]
    alg: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

fn b64url_decode(s: &str) -> Result<Vec<u8>, AppError> {
    URL_SAFE_NO_PAD
        .decode(s.as_bytes())
        .map_err(|_| AppError::invalid_input("Invalid base64url in JWKS."))
}

fn jwk_rsa_to_spki_der(jwk: &Jwk) -> Result<Vec<u8>, AppError> {
    let n_b64 = jwk
        .n
        .as_deref()
        .ok_or_else(|| AppError::invalid_input("JWKS missing n."))?;
    let e_b64 = jwk
        .e
        .as_deref()
        .ok_or_else(|| AppError::invalid_input("JWKS missing e."))?;
    let n = BigUint::from_bytes_be(&b64url_decode(n_b64)?);
    let e = BigUint::from_bytes_be(&b64url_decode(e_b64)?);
    let pub_key = rsa::RsaPublicKey::new(n, e)
        .map_err(|e| AppError::invalid_input(format!("Invalid RSA public key from JWKS: {e}")))?;
    let der = pub_key
        .to_public_key_der()
        .map_err(|e| AppError::invalid_input(format!("Could not encode JWKS public key: {e}")))?;
    Ok(der.as_bytes().to_vec())
}

async fn fetch_jwks_uncached(jwks_url: &str) -> Result<HashMap<String, Vec<u8>>, AppError> {
    let res = jwks_http().get(jwks_url).send().await.map_err(|e| {
        tracing::error!(target: "lti", %jwks_url, error = %e, "lti_jwks_fetch_failed");
        AppError::LtiToolConfiguration
    })?;
    if !res.status().is_success() {
        tracing::error!(
            target: "lti",
            %jwks_url,
            status = %res.status(),
            "lti_jwks_fetch_http_error"
        );
        return Err(AppError::LtiToolConfiguration);
    }
    let doc: JwksDocument = res.json().await.map_err(|e| {
        tracing::error!(target: "lti", %jwks_url, error = %e, "lti_jwks_parse_failed");
        AppError::LtiToolConfiguration
    })?;
    let mut keys_by_kid = HashMap::new();
    for jwk in doc.keys {
        if jwk.kty != "RSA" {
            continue;
        }
        if let Some(u) = &jwk.use_ {
            if u != "sig" {
                continue;
            }
        }
        let der = jwk_rsa_to_spki_der(&jwk)?;
        let kid = jwk.kid.clone().unwrap_or_else(|| "default".to_string());
        keys_by_kid.insert(kid, der);
    }
    if keys_by_kid.is_empty() {
        tracing::error!(target: "lti", %jwks_url, "lti_jwks_no_rsa_keys");
        return Err(AppError::LtiToolConfiguration);
    }
    Ok(keys_by_kid)
}

pub async fn decoding_key_for_jwt(jwks_url: &str, token: &str) -> Result<DecodingKey, AppError> {
    let header = decode_header(token).map_err(|_| AppError::invalid_input("Invalid ID token."))?;
    let kid = header.kid.as_deref().unwrap_or("default");

    {
        let cache = jwks_cache().lock().unwrap();
        if let Some(entry) = cache.get(jwks_url) {
            if entry.fetched_at.elapsed() < JWKS_CACHE_TTL {
                if let Some(der) = entry.keys_by_kid.get(kid) {
                    return Ok(DecodingKey::from_rsa_der(der));
                }
                if let Some(der) = entry.keys_by_kid.get("default") {
                    return Ok(DecodingKey::from_rsa_der(der));
                }
            }
        }
    }

    let keys_by_kid = fetch_jwks_uncached(jwks_url).await?;
    let snapshot = CachedJwks {
        fetched_at: Instant::now(),
        keys_by_kid: keys_by_kid.clone(),
    };
    {
        let mut cache = jwks_cache().lock().unwrap();
        cache.insert(jwks_url.to_string(), snapshot);
    }

    let der = keys_by_kid
        .get(kid)
        .or_else(|| keys_by_kid.get("default"))
        .ok_or(AppError::LtiToolConfiguration)?;
    Ok(DecodingKey::from_rsa_der(der))
}

/// LTI ID token body fields used by Lextures (additional IMS claims are ignored unless needed).
#[derive(Debug, Deserialize)]
pub struct LtiIdTokenBody {
    pub iss: String,
    pub sub: String,
    pub aud: serde_json::Value,
    pub exp: i64,
    pub iat: i64,
    pub nonce: String,
    pub email: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/deployment_id")]
    pub deployment_id: Option<String>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/message_type")]
    pub message_type: Option<String>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/version")]
    pub lti_version: Option<String>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/target_link_uri")]
    pub target_link_uri: Option<String>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/context")]
    pub context: Option<Value>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/roles")]
    pub roles: Option<Vec<String>>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/custom")]
    pub custom: Option<Value>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/lis")]
    pub lis: Option<Value>,
    #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/launch_presentation")]
    pub launch_presentation: Option<Value>,
}

fn audience_contains(aud: &serde_json::Value, expected: &str) -> bool {
    match aud {
        serde_json::Value::String(s) => s == expected,
        serde_json::Value::Array(arr) => arr.iter().any(|v| v.as_str() == Some(expected)),
        _ => false,
    }
}

/// Verifies RS256 signature, issuer, audience (client_id), and freshness (`iat` within 10 minutes).
pub fn verify_lti_id_token(
    token: &str,
    key: &DecodingKey,
    expected_iss: &str,
    expected_aud: &str,
) -> Result<LtiIdTokenBody, AppError> {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[expected_aud]);
    validation.validate_exp = true;
    validation.leeway = 60;
    validation.set_issuer(&[expected_iss]);

    let data = decode::<LtiIdTokenBody>(token, key, &validation)
        .map_err(|_| AppError::invalid_input("Invalid LTI ID token."))?;
    let claims = data.claims;

    if !audience_contains(&claims.aud, expected_aud) {
        return Err(AppError::invalid_input("LTI token audience mismatch."));
    }

    let now = chrono::Utc::now().timestamp();
    if (now - claims.iat).abs() > 600 {
        return Err(AppError::invalid_input(
            "LTI token iat is too old or in the future.",
        ));
    }

    Ok(claims)
}
