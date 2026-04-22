//! LTI 1.3 orchestration: provider launch, inbound AGS scores, NRPS roster shape.

use std::sync::Arc;

use chrono::{Duration, Utc};
use jsonwebtoken::encode;
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::lti_keys::LtiRuntime;
use crate::repos::course;
use crate::repos::course_grades;
use crate::repos::enrollment;
use crate::repos::lti as lti_repo;
use crate::repos::user;
use crate::services::auth;
use crate::services::lti_jwt::LtiIdTokenBody;
use crate::state::AppState;

pub fn require_lti(state: &AppState) -> Result<&Arc<LtiRuntime>, AppError> {
    state.lti.as_ref().ok_or(AppError::LtiDisabled)
}

pub async fn apply_inbound_ags_score(
    pool: &PgPool,
    line_item_url: &str,
    student_user_id: Uuid,
    score_given: f64,
    score_maximum: f64,
) -> Result<(), AppError> {
    if !score_given.is_finite() || !score_maximum.is_finite() || score_maximum <= 0.0 {
        return Err(AppError::invalid_input("Invalid score values."));
    }
    let Some(link) = lti_repo::find_resource_link_by_line_item_url(pool, line_item_url).await?
    else {
        return Err(AppError::NotFound);
    };
    let points = score_given.clamp(0.0, score_maximum).min(1e9_f64);
    course_grades::upsert_and_delete(
        pool,
        link.course_id,
        &[(student_user_id, link.structure_item_id, Some(points), None)],
        None,
        Some("LTI 1.3 AGS line-item score passback"),
    )
    .await?;
    tracing::info!(
        target: "lti",
        course_id = %link.course_id,
        student_user_id = %student_user_id,
        module_item_id = %link.structure_item_id,
        "lti.grade_passback_success"
    );
    Ok(())
}

#[derive(Debug, Serialize)]
struct NrpsMember {
    pub user_id: String,
    pub roles: Vec<String>,
    pub status: &'static str,
    pub name: String,
    pub email: Option<String>,
}

pub async fn nrps_memberships_for_course_code(
    pool: &PgPool,
    api_user_base: &str,
    course_code: &str,
) -> Result<serde_json::Value, AppError> {
    let Some(course_id) = course::get_id_by_course_code(pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    let rows = enrollment::list_for_course_code(pool, course_code).await?;
    let members: Vec<NrpsMember> = rows
        .into_iter()
        .map(|e| NrpsMember {
            user_id: format!("{api_user_base}/users/{}", e.user_id),
            roles: vec![map_nrps_role(&e.role)],
            status: "Active",
            name: e.display_name.unwrap_or_else(|| "Learner".into()),
            email: None,
        })
        .collect();
    Ok(json!({
        "id": format!("{api_user_base}/nrps/v2p/memberships/{course_id}"),
        "context": {
            "id": format!("{api_user_base}/courses/{course_code}"),
            "title": course_code,
        },
        "members": members
    }))
}

fn map_nrps_role(role: &str) -> String {
    match role {
        "Teacher" | "Instructor" => {
            "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor".into()
        }
        "TA" | "Ta" => "http://purl.imsglobal.org/vocab/lis/v2/membership#TeachingAssistant".into(),
        _ => "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner".into(),
    }
}

/// Provisions or resolves a Lextures user for an LTI platform subject.
pub async fn resolve_or_provision_platform_user(
    pool: &PgPool,
    platform_iss: &str,
    claims: &LtiIdTokenBody,
) -> Result<Uuid, AppError> {
    if let Some(uid) =
        lti_repo::find_user_for_platform_subject(pool, platform_iss, &claims.sub).await?
    {
        return Ok(uid);
    }

    let email = claims
        .email
        .clone()
        .filter(|e| e.contains('@'))
        .unwrap_or_else(|| format!("lti+{}@lti-provisioned.invalid", Uuid::new_v4()));

    let display = claims
        .name
        .clone()
        .or_else(|| {
            claims
                .email
                .as_ref()
                .map(|e| e.split('@').next().unwrap_or("Learner").to_string())
        })
        .filter(|s| !s.trim().is_empty());

    let hash = auth::hash_placeholder_password()?;
    let row = match user::insert_user(pool, &email, &hash, display.as_deref()).await {
        Ok(row) => row,
        Err(sqlx::Error::Database(ref db)) if db.code().as_deref() == Some("23505") => {
            let Some(found) = user::find_by_email_ci(pool, &email).await? else {
                return Err(AppError::invalid_input("Could not resolve LTI user."));
            };
            found
        }
        Err(e) => return Err(e.into()),
    };

    lti_repo::upsert_lti_platform_account(pool, platform_iss, &claims.sub, row.id).await?;
    Ok(row.id)
}

/// Build an LTI 1.3 `login_hint` JWT (platform → tool) for deep launches (minimal claim set).
pub fn build_platform_launch_hint_jwt(
    lti: &LtiRuntime,
    tool: &lti_repo::LtiExternalToolRow,
    user_id: Uuid,
    course_id: Uuid,
    structure_item_id: Uuid,
    locale: Option<&str>,
) -> Result<String, AppError> {
    #[derive(Serialize)]
    struct HintClaims<'a> {
        iss: &'a str,
        aud: &'a str,
        sub: String,
        iat: i64,
        exp: i64,
        #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/deployment_id")]
        deployment_id: &'a str,
        #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/target_link_uri")]
        target_link_uri: String,
        #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/context")]
        context: serde_json::Value,
        #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/custom")]
        custom: serde_json::Value,
        #[serde(rename = "https://purl.imsglobal.org/spec/lti/claim/launch_presentation")]
        launch_presentation: serde_json::Value,
    }

    let now = Utc::now();
    let exp = now + Duration::minutes(5);
    let iss = lti.platform_issuer();
    let target = format!(
        "{}/api/v1/lti/consumer/target?courseId={}&itemId={}",
        iss.trim_end_matches('/'),
        course_id,
        structure_item_id
    );
    let loc = locale.unwrap_or("en-US");
    let claims = HintClaims {
        iss: &iss,
        aud: &tool.tool_issuer,
        sub: user_id.to_string(),
        iat: now.timestamp(),
        exp: exp.timestamp(),
        deployment_id: "1",
        target_link_uri: target,
        context: json!({ "id": course_id.to_string() }),
        custom: json!({
            "courseId": course_id.to_string(),
            "structureItemId": structure_item_id.to_string(),
        }),
        launch_presentation: json!({ "locale": loc }),
    };
    let enc = lti.keys.encoding_key()?;
    let header = lti.keys.rsa_header();
    encode(&header, &claims, &enc)
        .map_err(|_| AppError::invalid_input("Could not sign LTI hint JWT."))
}
