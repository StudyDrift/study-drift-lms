//! RSA key material for LTI 1.3 RS256 signing and public JWKS publication.

use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use rsa::traits::PublicKeyParts;
use rsa::{RsaPrivateKey, RsaPublicKey};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::AppError;

/// Parsed RSA key pair for LTI JWT signing and JWKS endpoints.
#[derive(Clone)]
pub struct LtiRsaKeyPair {
    kid: String,
    private: RsaPrivateKey,
}

impl LtiRsaKeyPair {
    pub fn from_pkcs8_pem(pem: &str, kid: impl Into<String>) -> Result<Self, AppError> {
        let trimmed = pem.trim();
        if trimmed.is_empty() {
            return Err(AppError::invalid_input("LTI RSA private key PEM is empty."));
        }
        let private = RsaPrivateKey::from_pkcs8_pem(trimmed).map_err(|e| {
            AppError::invalid_input(format!("Invalid LTI RSA private key PEM: {e}"))
        })?;
        Ok(Self {
            kid: kid.into(),
            private,
        })
    }

    pub fn kid(&self) -> &str {
        &self.kid
    }

    pub fn encoding_key(&self) -> Result<EncodingKey, AppError> {
        let der = self.private.to_pkcs8_der().map_err(|e| {
            AppError::invalid_input(format!("Could not encode LTI private key: {e}"))
        })?;
        Ok(EncodingKey::from_rsa_der(der.as_bytes()))
    }

    pub fn rsa_header(&self) -> Header {
        let mut h = Header::new(Algorithm::RS256);
        h.kid = Some(self.kid.clone());
        h.typ = Some("JWT".into());
        h
    }

    /// JWKS document value for `keys` array (single key).
    pub fn jwk_public_json(&self) -> Result<JwkRsaPublic, AppError> {
        let pub_key = RsaPublicKey::from(&self.private);
        let n = pub_key.n().to_bytes_be();
        let e = pub_key.e().to_bytes_be();
        let mut hasher = Sha256::new();
        hasher.update(n.as_slice());
        hasher.update(b".");
        hasher.update(e.as_slice());
        let thumbprint: [u8; 32] = hasher.finalize().into();
        let x5t_s256 = URL_SAFE_NO_PAD.encode(thumbprint);
        Ok(JwkRsaPublic {
            kty: "RSA".into(),
            kid: self.kid.clone(),
            use_: "sig".into(),
            alg: "RS256".into(),
            n: URL_SAFE_NO_PAD.encode(n),
            e: URL_SAFE_NO_PAD.encode(e),
            x5t256: x5t_s256,
        })
    }
}

#[derive(Debug, Serialize)]
pub struct JwkRsaPublic {
    pub kty: String,
    pub kid: String,
    #[serde(rename = "use")]
    pub use_: String,
    pub alg: String,
    pub n: String,
    pub e: String,
    #[serde(rename = "x5t#S256")]
    pub x5t256: String,
}

#[derive(Clone)]
pub struct LtiRuntime {
    pub enabled: bool,
    /// Public API base URL (no trailing slash), used as LTI `iss` for platform-issued tokens.
    pub api_base_url: String,
    pub keys: Arc<LtiRsaKeyPair>,
}

impl LtiRuntime {
    pub fn platform_issuer(&self) -> String {
        self.api_base_url.clone()
    }
}
