//! SAML 2.0 service provider (plan 4.1) using `samael` and xmlsec for XML digital signatures.

use chrono::Duration;
use axum::response::Redirect;
use openssl::pkey::PKey;
use openssl::x509::X509;
use regex::Regex;
use samael::crypto::CertificateDer;
use samael::metadata::EntityDescriptor;
use samael::schema::Assertion;
use samael::service_provider::{Error as SamlError, ServiceProvider, ServiceProviderBuilder};
use serde_json::Value;
use sqlx::PgPool;
use std::sync::OnceLock;
use uuid::Uuid;

use base64::Engine as _;

use crate::error::AppError;
use crate::jwt::JwtSigner;
use crate::models::auth::{AuthResponse, UserPublic};
use crate::repos::saml as saml_repo;
use saml_repo::SamlIdpConfigRow;
use crate::repos::{rbac, user};
use crate::services::auth::{hash_placeholder_password, normalize_email};
use crate::state::SamlSpSettings;

static RE_IN_RESPONSE: OnceLock<Regex> = OnceLock::new();
static RE_RESPONSE_ID: OnceLock<Regex> = OnceLock::new();

fn in_response_re() -> &'static Regex {
    RE_IN_RESPONSE.get_or_init(|| {
        Regex::new(r#"(?i)InResponseTo\s*=\s*"([^"]*)""#).expect("regex")
    })
}

fn response_id_re() -> &'static Regex {
    RE_RESPONSE_ID.get_or_init(|| {
        Regex::new(r#"(?i)<[a-z0-9-]+:Response[^>]*\bID\s*=\s*"([^"]*)""#).expect("regex")
    })
}

/// Raw SAML `Response` element — extract `InResponseTo` and `Response@ID` before full parse.
pub fn scan_saml_response_shallow(xml: &str) -> (Option<String>, Option<String>) {
    let irt = in_response_re()
        .captures(xml)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
        .filter(|s| !s.is_empty());
    let rid = response_id_re()
        .captures(xml)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
    (irt, rid)
}

fn xml_attr_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn pem_body_b64(pem: &str) -> Result<String, AppError> {
    let s: String = pem
        .lines()
        .filter(|l| !l.trim_start().starts_with("-----"))
        .flat_map(|l| l.chars())
        .filter(|c| !c.is_whitespace())
        .collect();
    if s.is_empty() {
        return Err(AppError::invalid_input("X.509 PEM has no base64 body."));
    }
    Ok(s)
}

fn idp_row_to_metadata_xml(row: &SamlIdpConfigRow) -> Result<String, AppError> {
    let cert_b64 = pem_body_b64(&row.idp_cert_pem)?;
    let entity = xml_attr_escape(&row.entity_id);
    let sso = xml_attr_escape(&row.sso_url);
    Ok(format!(
        r#"<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  entityID="{entity}">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo>
        <ds:X509Data>
          <ds:X509Certificate>{cert_b64}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="{sso}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>"#
    ))
}

/// IdP `EntityDescriptor` for samael validation.
fn idp_entity_descriptor_from_row(row: &SamlIdpConfigRow) -> Result<EntityDescriptor, AppError> {
    idp_row_to_metadata_xml(row)?
        .parse::<EntityDescriptor>()
        .map_err(|e| {
            AppError::UnprocessableEntity {
                message: format!("Invalid IdP configuration metadata: {e}"),
            }
        })
}

fn sp_cert_der(pem: &str) -> Result<CertificateDer, AppError> {
    let c = X509::from_pem(pem.as_bytes()).map_err(|e| {
        AppError::invalid_input(format!("Invalid SAML SP X.509 certificate: {e}"))
    })?;
    let der = c
        .to_der()
        .map_err(|e| AppError::invalid_input(format!("Invalid SAML SP X.509 DER: {e}")))?;
    Ok(der.into())
}

fn build_sp(
    sp: &SamlSpSettings,
    idp_desc: &EntityDescriptor,
    allow_idp_initiated: bool,
) -> Result<ServiceProvider, AppError> {
    let public_base = sp.public_base_url.trim_end_matches('/');
    let acs = format!("{public_base}/auth/saml/acs");
    let slo = format!("{public_base}/auth/saml/slo");
    let sp_cert = sp_cert_der(&sp.sp_x509_pem)?;
    let mut bld = ServiceProviderBuilder::default();
    bld.entity_id(Some(sp.sp_entity_id.clone()));
    bld.metadata_url(Some(sp.sp_entity_id.clone()));
    bld.acs_url(Some(acs));
    bld.slo_url(Some(slo));
    bld.certificate(Some(sp_cert));
    bld.idp_metadata(idp_desc.clone());
    bld.allow_idp_initiated(allow_idp_initiated);
    bld.max_clock_skew(Duration::minutes(5));
    bld.max_issue_delay(Duration::minutes(10));
    if let Some(ref pk) = sp.sp_private_key_pem {
        let pkey = PKey::private_key_from_pem(pk.as_bytes()).map_err(|e| {
            AppError::invalid_input(format!("Invalid SAML SP private key PEM: {e}"))
        })?;
        bld.key(Some(pkey));
    }
    bld.build()
        .map_err(|e| AppError::UnprocessableEntity {
            message: e.to_string(),
        })
}

/// SP role metadata only (idp is empty).
fn sp_service_for_metadata(sp: &SamlSpSettings) -> Result<ServiceProvider, AppError> {
    let public_base = sp.public_base_url.trim_end_matches('/');
    let acs = format!("{public_base}/auth/saml/acs");
    let slo = format!("{public_base}/auth/saml/slo");
    let sp_cert = sp_cert_der(&sp.sp_x509_pem)?;
    ServiceProviderBuilder::default()
        .entity_id(Some(sp.sp_entity_id.clone()))
        .metadata_url(Some(sp.sp_entity_id.clone()))
        .acs_url(Some(acs))
        .slo_url(Some(slo))
        .certificate(Some(sp_cert))
        .idp_metadata(EntityDescriptor::default())
        .max_clock_skew(Duration::minutes(5))
        .max_issue_delay(Duration::minutes(10))
        .build()
        .map_err(|e| AppError::UnprocessableEntity {
            message: e.to_string(),
        })
}

/// `GET /auth/saml/metadata` – XML for IdP registration.
pub fn sp_metadata_xml(sp: &SamlSpSettings) -> Result<String, AppError> {
    let s = sp_service_for_metadata(sp)?;
    let ent = s.metadata().map_err(|e| AppError::UnprocessableEntity {
        message: format!("Could not build SP metadata: {e}"),
    })?;
    samael::traits::ToXml::to_string(&ent).map_err(|e| AppError::UnprocessableEntity {
        message: e.to_string(),
    })
}

/// Start SP-initiated SSO: HTTP-Redirect to IdP.
pub async fn start_sso_redirect(
    pool: &PgPool,
    sp: &SamlSpSettings,
    idp_id: Uuid,
    relay_state: Option<String>,
) -> Result<Redirect, AppError> {
    let _ = saml_repo::delete_stale_authn_state(pool).await;
    let _ = saml_repo::delete_stale_replay_guard(pool).await;

    let idp_row = saml_repo::get_idp_by_id(pool, idp_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let idp_desc = idp_entity_descriptor_from_row(&idp_row)?;
    let svc = build_sp(sp, &idp_desc, false)?;
    let mut ar = svc
        .make_authentication_request(&idp_row.sso_url)
        .map_err(|e| AppError::UnprocessableEntity {
            message: e.to_string(),
        })?;
    ar.id = format!("id-{}", Uuid::new_v4());

    saml_repo::save_authn_state(pool, &ar.id, idp_id, relay_state.as_deref())
        .await?;

    let rs = relay_state.unwrap_or_default();
    let url = ar.redirect(&rs).map_err(|e| AppError::UnprocessableEntity {
        message: e.to_string(),
    })?;
    let u = url.ok_or_else(|| AppError::UnprocessableEntity {
        message: "SAML: missing HTTP-Redirect destination for AuthnRequest".into(),
    })?;
    tracing::info!(target: "saml", idp = %idp_row.entity_id, "saml.authn_requests_total");
    Ok(Redirect::temporary(u.as_str()))
}

/// Parse the SAML `Response` (untrusted XML after base64), validate signature, map user, return JWT.
pub async fn acs_post_form(
    pool: &PgPool,
    jwt: &JwtSigner,
    sp: &SamlSpSettings,
    saml_response_b64: &str,
    _relay_state: Option<&str>,
) -> Result<AuthResponse, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(saml_response_b64)
        .map_err(|e| {
            AppError::invalid_input(format!("Invalid base64 in SAMLResponse: {e}"))
        })?;
    let xml = String::from_utf8_lossy(&bytes);
    let xmls = xml.trim();
    if xmls.is_empty() {
        return Err(AppError::invalid_input("Empty SAML response body."));
    }

    let (in_resp_to, response_id) = scan_saml_response_shallow(xmls);
    saml_repo::delete_stale_authn_state(pool).await?;
    saml_repo::delete_stale_replay_guard(pool).await?;

    let (allow_idp, possible_ids, idp_id): (bool, Option<Vec<String>>, Uuid) =
        if let Some(ref irt) = in_resp_to {
            if let Some((saved_idp, _relay)) = saml_repo::take_authn_state(pool, irt).await? {
                (false, Some(vec![irt.clone()]), saved_idp)
            } else {
                tracing::warn!(target: "saml", in_response_to = %irt, "saml.assertions_failed.unknown_in_response_to");
                return Err(AppError::invalid_input(
                    "SAML: unknown or expired InResponseTo (re-run login from the app).",
                ));
            }
        } else {
            let d = saml_repo::get_default_idp(pool).await?.ok_or_else(|| {
                AppError::invalid_input("SAML: no IdP is configured; cannot complete sign-in.")
            })?;
            (true, None, d.id)
        };

    let idp_row = saml_repo::get_idp_by_id(pool, idp_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let idp_desc = idp_entity_descriptor_from_row(&idp_row)?;
    let svc = build_sp(sp, &idp_desc, allow_idp)?;

    let id_slice: Option<Vec<&str>> = possible_ids
        .as_ref()
        .map(|v| v.iter().map(String::as_str).collect());
    let possible_ref: Option<&[&str]> = id_slice
        .as_ref()
        .map(|s| s.as_slice());

    let assertion = match svc.parse_xml_response(xmls, possible_ref) {
        Ok(a) => {
            tracing::info!(target: "saml", idp = %idp_row.entity_id, "saml.assertions_validated");
            a
        }
        Err(e) => {
            let msg = saml_error_message(&e);
            tracing::warn!(target: "saml", idp = %idp_row.entity_id, error = %msg, "saml.assertions_failed");
            return Err(AppError::invalid_input(format!("SAML: invalid assertion ({msg})")));
        }
    };

    let replay_key: String = if in_resp_to.is_none() {
        if let Some(ref r) = response_id {
            format!("resp:{r}")
        } else {
            "resp:unknown".to_string()
        }
    } else {
        in_resp_to.clone().unwrap()
    };

    let (email, first, last) = map_assertion(&assertion, &idp_row)?;
    if email.is_empty() || !email.contains('@') {
        tracing::warn!(target: "saml", "saml.assertions_failed.missing_email");
        return Err(AppError::invalid_input(
            "SAML: could not obtain an email address for this user.",
        ));
    }

    let (user_row, created) = if let Some(row) = user::find_by_email_ci(pool, &email).await? {
        (row, false)
    } else {
        let h = hash_placeholder_password()?;
        let disp: Option<String> = match (first.as_deref(), last.as_deref()) {
            (None, None) => None,
            (Some(f), None) if !f.trim().is_empty() => Some(f.trim().to_string()),
            (None, Some(l)) if !l.trim().is_empty() => Some(l.trim().to_string()),
            (Some(f), Some(l)) => {
                if f.trim().is_empty() && l.trim().is_empty() {
                    None
                } else if f.trim().is_empty() {
                    Some(l.trim().to_string())
                } else if l.trim().is_empty() {
                    Some(f.trim().to_string())
                } else {
                    Some(format!("{} {}", f.trim(), l.trim()))
                }
            }
            _ => None,
        };
        let row = user::insert_user(pool, &email, &h, disp.as_deref()).await?;
        (row, true)
    };

    if !created {
        let f = first.as_deref().filter(|s| !s.trim().is_empty());
        let l = last.as_deref().filter(|s| !s.trim().is_empty());
        if f.is_some() || l.is_some() {
            let _ = user::update_profile(pool, user_row.id, f, l, None, None).await;
        }
    }

    if created {
        rbac::assign_user_role_by_name(
            pool,
            user_row.id,
            if guess_teacher_from_assertion(&assertion, &idp_row) {
                "Teacher"
            } else {
                "Student"
            },
        )
        .await?;
    }

    let ok = saml_repo::record_replay(pool, &replay_key).await?;
    if !ok {
        tracing::warn!(target: "saml", correlation = %replay_key, "saml.assertions_failed.replay");
        return Err(AppError::invalid_input_code(
            crate::error::ErrorCode::NonceAlreadyUsed,
            "Assertion replay detected.",
        ));
    }

    let access_token = jwt.sign(user_row.id, &user_row.email)?;
    Ok(AuthResponse {
        access_token,
        token_type: "Bearer".into(),
        user: UserPublic {
            id: user_row.id,
            email: user_row.email,
            display_name: user_row.display_name,
            first_name: user_row.first_name,
            last_name: user_row.last_name,
            avatar_url: user_row.avatar_url,
            ui_theme: user_row.ui_theme,
            sid: user_row.sid,
        },
    })
}

fn guess_teacher_from_assertion(assertion: &Assertion, idp: &SamlIdpConfigRow) -> bool {
    let want = idp
        .attribute_mapping
        .get("role")
        .and_then(|v| v.as_str());
    for stmt in assertion.attribute_statements.as_deref().unwrap_or(&[]) {
        for att in &stmt.attributes {
            let is_roleish = att
                .name
                .as_deref()
                .is_some_and(|n| n.to_ascii_lowercase().contains("role"))
                || att
                    .friendly_name
                    .as_deref()
                    .is_some_and(|n| n.eq_ignore_ascii_case("role"));
            if want.is_none() && !is_roleish {
                continue;
            }
            if let Some(w) = want {
                if !att
                    .name
                    .as_deref()
                    .is_some_and(|n| n.eq_ignore_ascii_case(w))
                {
                    continue;
                }
            }
            for v in &att.values {
                if let Some(val) = v.value.as_deref() {
                    let t = val.to_ascii_lowercase();
                    if t.contains("instructor")
                        || t.contains("teacher")
                        || t.contains("faculty")
                    {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn saml_error_message(e: &SamlError) -> String {
    let mut s = e.to_string();
    if let Some(src) = std::error::Error::source(e) {
        s.push_str(": ");
        s.push_str(&src.to_string());
    }
    s
}

/// Map `Assertion` to email + optional names using the IdP’s `attribute_mapping` JSON
/// (keys: `email`, `firstName`, `lastName`, with values = SAML `Attribute@Name` or friendlyName).
fn map_assertion(
    a: &Assertion,
    idp: &SamlIdpConfigRow,
) -> Result<(String, Option<String>, Option<String>), AppError> {
    let map = &idp.attribute_mapping;
    let def_email: &[&str] = &[
        "urn:oid:0.9.2342.19200300.100.1.3",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        "mail",
        "email",
        "uid",
    ];
    let def_first: &[&str] = &[
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
        "firstName",
        "first_name",
        "givenName",
    ];
    let def_last: &[&str] = &[
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
        "lastName",
        "last_name",
        "sn",
        "surname",
    ];

    let mut email_wants: Vec<String> = def_email.iter().map(|s| (*s).to_string()).collect();
    if let Some(k) = get_map_str(map, "email") {
        email_wants.insert(0, k);
    }
    let mut first_wants: Vec<String> = def_first.iter().map(|s| (*s).to_string()).collect();
    if let Some(k) = get_map_str(map, "firstName") {
        first_wants.insert(0, k);
    }
    let mut last_wants: Vec<String> = def_last.iter().map(|s| (*s).to_string()).collect();
    if let Some(k) = get_map_str(map, "lastName") {
        last_wants.insert(0, k);
    }

    let mut email = get_attr(a, &email_wants)?;
    if email.is_empty() {
        if let Some(sub) = a.subject.as_ref() {
            if let Some(n) = &sub.name_id {
                if n.value.contains('@') {
                    email = n.value.clone();
                }
            }
        }
    }
    let first = get_attr(a, &first_wants)?;
    let last = get_attr(a, &last_wants)?;

    let f = if first.trim().is_empty() {
        None
    } else {
        Some(first)
    };
    let l = if last.trim().is_empty() {
        None
    } else {
        Some(last)
    };
    Ok((normalize_email(&email), f, l))
}

fn get_map_str(m: &Value, key: &str) -> Option<String> {
    m.get(key).and_then(|v| v.as_str().map(String::from))
}

fn get_attr(
    a: &Assertion,
    wanted: &[String],
) -> Result<String, AppError> {
    let wanted: Vec<String> = wanted
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();
    for stmt in a.attribute_statements.as_deref().unwrap_or(&[]) {
        for att in &stmt.attributes {
            let name_l = att.name.as_deref().map(|n| n.to_ascii_lowercase());
            let friend_l = att
                .friendly_name
                .as_deref()
                .map(|n| n.to_ascii_lowercase());
            for w in &wanted {
                if name_l
                    .as_ref()
                    .is_some_and(|n| n == w)
                    || friend_l
                        .as_ref()
                        .is_some_and(|f| f == w)
                {
                    if let Some(f) = att
                        .values
                        .first()
                        .and_then(|v| v.value.as_ref())
                    {
                        return Ok(f.clone());
                    }
                }
            }
        }
    }
    Ok(String::new())
}
