//! Recommendations cache, instructor overrides, and analytics events.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOverrideRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub structure_item_id: Uuid,
    pub override_type: String,
    pub surface: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

pub async fn list_overrides_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<RecommendationOverrideRow>, sqlx::Error> {
    sqlx::query_as::<_, RecommendationOverrideRow>(&format!(
        r#"
        SELECT id, course_id, structure_item_id, override_type, surface, created_by, created_at
        FROM {}
        WHERE course_id = $1
        ORDER BY created_at ASC
        "#,
        schema::COURSE_RECOMMENDATION_OVERRIDES
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn count_pins_for_course(pool: &PgPool, course_id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT COUNT(*)::int8 FROM {}
        WHERE course_id = $1 AND override_type = 'pin'
        "#,
        schema::COURSE_RECOMMENDATION_OVERRIDES
    ))
    .bind(course_id)
    .fetch_one(pool)
    .await
}

pub async fn insert_override(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
    override_type: &str,
    surface: Option<&str>,
    created_by: Uuid,
) -> Result<RecommendationOverrideRow, sqlx::Error> {
    sqlx::query_as::<_, RecommendationOverrideRow>(&format!(
        r#"
        INSERT INTO {} (course_id, structure_item_id, override_type, surface, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, course_id, structure_item_id, override_type, surface, created_by, created_at
        "#,
        schema::COURSE_RECOMMENDATION_OVERRIDES
    ))
    .bind(course_id)
    .bind(structure_item_id)
    .bind(override_type)
    .bind(surface)
    .bind(created_by)
    .fetch_one(pool)
    .await
}

pub async fn delete_override_for_course(
    pool: &PgPool,
    course_id: Uuid,
    override_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        "DELETE FROM {} WHERE id = $1 AND course_id = $2",
        schema::COURSE_RECOMMENDATION_OVERRIDES
    ))
    .bind(override_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedRecommendations {
    #[serde(default)]
    pub recommendations: Vec<serde_json::Value>,
    #[serde(default)]
    pub degraded: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct RecommendationCacheRow {
    recommendations: serde_json::Value,
    expires_at: DateTime<Utc>,
}

pub async fn get_cache(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    surface: &str,
) -> Result<Option<(CachedRecommendations, bool)>, sqlx::Error> {
    let row = sqlx::query_as::<_, RecommendationCacheRow>(&format!(
        r#"
        SELECT recommendations, expires_at
        FROM {}
        WHERE user_id = $1 AND course_id = $2 AND surface = $3
        "#,
        schema::RECOMMENDATION_CACHE
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(surface)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };
    let expired = row.expires_at <= Utc::now();
    let parsed: CachedRecommendations =
        serde_json::from_value(row.recommendations).unwrap_or(CachedRecommendations {
            recommendations: vec![],
            degraded: false,
        });
    Ok(Some((parsed, expired)))
}

pub async fn upsert_cache(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    surface: &str,
    payload: &CachedRecommendations,
    ttl: chrono::Duration,
) -> Result<(), sqlx::Error> {
    let expires_at = Utc::now() + ttl;
    let json = serde_json::to_value(payload)
        .unwrap_or_else(|_| serde_json::json!({ "recommendations": [], "degraded": false }));
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, course_id, surface, recommendations, computed_at, expires_at)
        VALUES ($1, $2, $3, $4, NOW(), $5)
        ON CONFLICT (user_id, course_id, surface) DO UPDATE
        SET recommendations = EXCLUDED.recommendations,
            computed_at = NOW(),
            expires_at = EXCLUDED.expires_at
        "#,
        schema::RECOMMENDATION_CACHE
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(surface)
    .bind(json)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_event(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    item_id: Option<Uuid>,
    surface: &str,
    event_type: &str,
    rank: Option<i16>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, course_id, item_id, surface, event_type, rank)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        schema::RECOMMENDATION_EVENTS
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(item_id)
    .bind(surface)
    .bind(event_type)
    .bind(rank)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ConceptQuizItemRow {
    pub concept_id: Uuid,
    pub structure_item_id: Uuid,
    pub title: String,
}

/// Maps each course concept to quiz structure items that deliver tagged questions (fixed or via pool).
pub async fn list_concept_quiz_structure_items(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<ConceptQuizItemRow>, sqlx::Error> {
    sqlx::query_as::<_, ConceptQuizItemRow>(&format!(
        r#"
        SELECT DISTINCT cqt.concept_id, si.id AS structure_item_id, si.title
        FROM {} cqt
        INNER JOIN {} qu ON qu.id = cqt.question_id AND qu.course_id = $1
        INNER JOIN {} qqr ON qqr.structure_item_id IN (
            SELECT id FROM {} WHERE course_id = $1
        )
        AND (
            qqr.question_id = qu.id
            OR EXISTS (
                SELECT 1 FROM {} m
                WHERE m.pool_id = qqr.pool_id AND m.question_id = qu.id
            )
        )
        INNER JOIN {} si ON si.id = qqr.structure_item_id AND si.course_id = $1 AND si.kind = 'quiz'
        "#,
        schema::CONCEPT_QUESTION_TAGS,
        schema::QUESTIONS,
        schema::QUIZ_QUESTION_REFS,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::QUESTION_POOL_MEMBERS,
        schema::COURSE_STRUCTURE_ITEMS,
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LastPathEventRow {
    pub to_item_id: Uuid,
}

pub async fn get_last_path_to_item(
    pool: &PgPool,
    enrollment_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    let row = sqlx::query_as::<_, LastPathEventRow>(&format!(
        r#"
        SELECT to_item_id
        FROM {}
        WHERE enrollment_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
        schema::LEARNER_PATH_EVENTS
    ))
    .bind(enrollment_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.to_item_id))
}

/// Prerequisite edges where both endpoints are in `ids` (caller supplies the relevant concept universe).
pub async fn list_prerequisites_among_ids(
    pool: &PgPool,
    ids: &[Uuid],
) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as(
        r#"
        SELECT concept_id, prerequisite_id
        FROM course.concept_prerequisites
        WHERE concept_id = ANY($1) AND prerequisite_id = ANY($1)
        "#,
    )
    .bind(ids)
    .fetch_all(pool)
    .await
}
