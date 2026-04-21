//! Diagnostic placement configuration and learner attempts (plan 1.7).

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CourseDiagnosticRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub concept_ids: Vec<Uuid>,
    pub max_items: i32,
    pub stopping_rule: String,
    pub se_threshold: f64,
    pub retake_policy: String,
    pub placement_rules: JsonValue,
    pub theta_cut_scores: Option<JsonValue>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DiagnosticAttemptRow {
    pub id: Uuid,
    pub diagnostic_id: Uuid,
    pub enrollment_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub bypassed: bool,
    pub placement_item_id: Option<Uuid>,
    pub theta_summary: Option<JsonValue>,
    pub placement_summary: Option<JsonValue>,
    pub responses: JsonValue,
    pub session_state: JsonValue,
    pub created_at: DateTime<Utc>,
}

pub async fn get_diagnostic_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Option<CourseDiagnosticRow>, sqlx::Error> {
    sqlx::query_as::<_, CourseDiagnosticRow>(&format!(
        r#"
        SELECT
            id, course_id, concept_ids,
            max_items, stopping_rule::text, (se_threshold)::float8,
            retake_policy, placement_rules, theta_cut_scores,
            created_at, updated_at
        FROM {}
        WHERE course_id = $1
        "#,
        schema::COURSE_DIAGNOSTICS
    ))
    .bind(course_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_course_diagnostic(
    pool: &PgPool,
    course_id: Uuid,
    concept_ids: &[Uuid],
    max_items: i32,
    stopping_rule: &str,
    se_threshold: f64,
    retake_policy: &str,
    placement_rules: &JsonValue,
    theta_cut_scores: Option<&JsonValue>,
) -> Result<CourseDiagnosticRow, sqlx::Error> {
    sqlx::query_as::<_, CourseDiagnosticRow>(&format!(
        r#"
        INSERT INTO {} (
            course_id, concept_ids, max_items, stopping_rule, se_threshold,
            retake_policy, placement_rules, theta_cut_scores
        )
        VALUES ($1, $2, $3, $4::course.diagnostic_stopping_rule, $5, $6, $7, $8)
        ON CONFLICT (course_id) DO UPDATE SET
            concept_ids = EXCLUDED.concept_ids,
            max_items = EXCLUDED.max_items,
            stopping_rule = EXCLUDED.stopping_rule,
            se_threshold = EXCLUDED.se_threshold,
            retake_policy = EXCLUDED.retake_policy,
            placement_rules = EXCLUDED.placement_rules,
            theta_cut_scores = EXCLUDED.theta_cut_scores,
            updated_at = NOW()
        RETURNING
            id, course_id, concept_ids,
            max_items, stopping_rule::text, (se_threshold)::float8,
            retake_policy, placement_rules, theta_cut_scores,
            created_at, updated_at
        "#,
        schema::COURSE_DIAGNOSTICS
    ))
    .bind(course_id)
    .bind(concept_ids)
    .bind(max_items)
    .bind(stopping_rule)
    .bind(se_threshold)
    .bind(retake_policy)
    .bind(placement_rules)
    .bind(theta_cut_scores)
    .fetch_one(pool)
    .await
}

pub async fn insert_diagnostic_attempt(
    pool: &PgPool,
    diagnostic_id: Uuid,
    enrollment_id: Uuid,
    session_state: &JsonValue,
) -> Result<DiagnosticAttemptRow, sqlx::Error> {
    sqlx::query_as::<_, DiagnosticAttemptRow>(&format!(
        r#"
        INSERT INTO {} (diagnostic_id, enrollment_id, session_state)
        VALUES ($1, $2, $3)
        RETURNING
            id, diagnostic_id, enrollment_id, started_at, completed_at, bypassed,
            placement_item_id, theta_summary, placement_summary, responses, session_state, created_at
        "#,
        schema::DIAGNOSTIC_ATTEMPTS
    ))
    .bind(diagnostic_id)
    .bind(enrollment_id)
    .bind(session_state)
    .fetch_one(pool)
    .await
}

pub async fn get_attempt_by_id(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Option<DiagnosticAttemptRow>, sqlx::Error> {
    sqlx::query_as::<_, DiagnosticAttemptRow>(&format!(
        r#"
        SELECT
            id, diagnostic_id, enrollment_id, started_at, completed_at, bypassed,
            placement_item_id, theta_summary, placement_summary, responses, session_state, created_at
        FROM {}
        WHERE id = $1
        "#,
        schema::DIAGNOSTIC_ATTEMPTS
    ))
    .bind(attempt_id)
    .fetch_optional(pool)
    .await
}

pub async fn latest_attempt_for_enrollment(
    pool: &PgPool,
    diagnostic_id: Uuid,
    enrollment_id: Uuid,
) -> Result<Option<DiagnosticAttemptRow>, sqlx::Error> {
    sqlx::query_as::<_, DiagnosticAttemptRow>(&format!(
        r#"
        SELECT
            id, diagnostic_id, enrollment_id, started_at, completed_at, bypassed,
            placement_item_id, theta_summary, placement_summary, responses, session_state, created_at
        FROM {}
        WHERE diagnostic_id = $1 AND enrollment_id = $2
        ORDER BY started_at DESC
        LIMIT 1
        "#,
        schema::DIAGNOSTIC_ATTEMPTS
    ))
    .bind(diagnostic_id)
    .bind(enrollment_id)
    .fetch_optional(pool)
    .await
}

pub async fn update_attempt_session(
    pool: &PgPool,
    attempt_id: Uuid,
    session_state: &JsonValue,
    responses: &JsonValue,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET session_state = $2, responses = $3
        WHERE id = $1 AND completed_at IS NULL
        "#,
        schema::DIAGNOSTIC_ATTEMPTS
    ))
    .bind(attempt_id)
    .bind(session_state)
    .bind(responses)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn complete_attempt(
    pool: &PgPool,
    attempt_id: Uuid,
    placement_item_id: Option<Uuid>,
    theta_summary: &JsonValue,
    placement_summary: &JsonValue,
    responses: &JsonValue,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET completed_at = NOW(),
            bypassed = FALSE,
            placement_item_id = $2,
            theta_summary = $3,
            placement_summary = $4,
            responses = $5,
            session_state = '{{}}'::jsonb
        WHERE id = $1
        "#,
        schema::DIAGNOSTIC_ATTEMPTS
    ))
    .bind(attempt_id)
    .bind(placement_item_id)
    .bind(theta_summary)
    .bind(placement_summary)
    .bind(responses)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn bypass_attempt(
    pool: &PgPool,
    attempt_id: Uuid,
    responses: &JsonValue,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET completed_at = NOW(),
            bypassed = TRUE,
            placement_item_id = NULL,
            theta_summary = NULL,
            placement_summary = NULL,
            responses = $2,
            session_state = '{{}}'::jsonb
        WHERE id = $1
        "#,
        schema::DIAGNOSTIC_ATTEMPTS
    ))
    .bind(attempt_id)
    .bind(responses)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_bypassed_attempt(
    pool: &PgPool,
    diagnostic_id: Uuid,
    enrollment_id: Uuid,
) -> Result<DiagnosticAttemptRow, sqlx::Error> {
    sqlx::query_as::<_, DiagnosticAttemptRow>(&format!(
        r#"
        INSERT INTO {} (diagnostic_id, enrollment_id, completed_at, bypassed, responses, session_state)
        VALUES ($1, $2, NOW(), TRUE, '[]'::jsonb, '{{}}'::jsonb)
        RETURNING
            id, diagnostic_id, enrollment_id, started_at, completed_at, bypassed,
            placement_item_id, theta_summary, placement_summary, responses, session_state, created_at
        "#,
        schema::DIAGNOSTIC_ATTEMPTS
    ))
    .bind(diagnostic_id)
    .bind(enrollment_id)
    .fetch_one(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DiagnosticResultGridRow {
    pub enrollment_id: Uuid,
    pub user_id: Uuid,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub attempt_id: Option<Uuid>,
    pub completed_at: Option<DateTime<Utc>>,
    pub bypassed: Option<bool>,
    pub theta_summary: Option<JsonValue>,
    pub placement_summary: Option<JsonValue>,
}

pub async fn list_diagnostic_results_for_course(
    pool: &PgPool,
    diagnostic_id: Uuid,
    course_id: Uuid,
) -> Result<Vec<DiagnosticResultGridRow>, sqlx::Error> {
    sqlx::query_as::<_, DiagnosticResultGridRow>(&format!(
        r#"
        SELECT
            e.id AS enrollment_id,
            e.user_id,
            u.display_name,
            u.email,
            da.id AS attempt_id,
            da.completed_at,
            da.bypassed,
            da.theta_summary,
            da.placement_summary
        FROM {} e
        INNER JOIN {} u ON u.id = e.user_id
        LEFT JOIN LATERAL (
            SELECT a.*
            FROM {} a
            WHERE a.enrollment_id = e.id AND a.diagnostic_id = $1
            ORDER BY a.started_at DESC
            LIMIT 1
        ) da ON TRUE
        WHERE e.course_id = $2 AND e.role = 'student'
        ORDER BY COALESCE(u.display_name, u.email, u.id::text) ASC
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::USERS,
        schema::DIAGNOSTIC_ATTEMPTS
    ))
    .bind(diagnostic_id)
    .bind(course_id)
    .fetch_all(pool)
    .await
}
