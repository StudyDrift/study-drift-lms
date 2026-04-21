//! Adaptive path rules, enrollment overrides, and learner path audit rows.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct StructurePathRuleRow {
    pub id: Uuid,
    pub structure_item_id: Uuid,
    pub rule_type: String,
    pub concept_ids: Vec<Uuid>,
    pub threshold: f64,
    pub target_item_id: Option<Uuid>,
    pub priority: i16,
    pub created_at: DateTime<Utc>,
}

pub async fn list_rules_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<StructurePathRuleRow>, sqlx::Error> {
    sqlx::query_as::<_, StructurePathRuleRow>(&format!(
        r#"
        SELECT r.id, r.structure_item_id, r.rule_type::text AS rule_type,
               r.concept_ids,
               (r.threshold)::float8 AS threshold,
               r.target_item_id, r.priority, r.created_at
        FROM {} r
        INNER JOIN {} i ON i.id = r.structure_item_id
        WHERE i.course_id = $1
        ORDER BY r.structure_item_id, r.priority DESC, r.created_at ASC
        "#,
        schema::STRUCTURE_ITEM_PATH_RULES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn list_rules_for_structure_item(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
) -> Result<Vec<StructurePathRuleRow>, sqlx::Error> {
    sqlx::query_as::<_, StructurePathRuleRow>(&format!(
        r#"
        SELECT r.id, r.structure_item_id, r.rule_type::text AS rule_type,
               r.concept_ids,
               (r.threshold)::float8 AS threshold,
               r.target_item_id, r.priority, r.created_at
        FROM {} r
        INNER JOIN {} i ON i.id = r.structure_item_id
        WHERE i.course_id = $1 AND r.structure_item_id = $2
        ORDER BY r.priority DESC, r.created_at ASC
        "#,
        schema::STRUCTURE_ITEM_PATH_RULES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(structure_item_id)
    .fetch_all(pool)
    .await
}

pub async fn insert_rule(
    pool: &PgPool,
    structure_item_id: Uuid,
    rule_type: &str,
    concept_ids: &[Uuid],
    threshold: f64,
    target_item_id: Option<Uuid>,
    priority: i16,
) -> Result<StructurePathRuleRow, sqlx::Error> {
    sqlx::query_as::<_, StructurePathRuleRow>(&format!(
        r#"
        INSERT INTO {} (structure_item_id, rule_type, concept_ids, threshold, target_item_id, priority)
        VALUES ($1, $2::course.path_rule_type, $3, $4, $5, $6)
        RETURNING id, structure_item_id, rule_type::text AS rule_type,
                  concept_ids, (threshold)::float8 AS threshold, target_item_id, priority, created_at
        "#,
        schema::STRUCTURE_ITEM_PATH_RULES
    ))
    .bind(structure_item_id)
    .bind(rule_type)
    .bind(concept_ids)
    .bind(threshold)
    .bind(target_item_id)
    .bind(priority)
    .fetch_one(pool)
    .await
}

pub async fn delete_rule_for_course(
    pool: &PgPool,
    course_id: Uuid,
    rule_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        r#"
        DELETE FROM {} r
        USING {} i
        WHERE r.id = $1 AND r.structure_item_id = i.id AND i.course_id = $2
        "#,
        schema::STRUCTURE_ITEM_PATH_RULES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(rule_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EnrollmentPathOverrideRow {
    pub enrollment_id: Uuid,
    pub item_sequence: Vec<Uuid>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

pub async fn get_path_override(
    pool: &PgPool,
    enrollment_id: Uuid,
) -> Result<Option<EnrollmentPathOverrideRow>, sqlx::Error> {
    sqlx::query_as::<_, EnrollmentPathOverrideRow>(&format!(
        r#"
        SELECT enrollment_id, item_sequence, created_by, created_at
        FROM {}
        WHERE enrollment_id = $1
        "#,
        schema::ENROLLMENT_PATH_OVERRIDES
    ))
    .bind(enrollment_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_path_override(
    pool: &PgPool,
    enrollment_id: Uuid,
    item_sequence: &[Uuid],
    created_by: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (enrollment_id, item_sequence, created_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (enrollment_id) DO UPDATE
        SET item_sequence = EXCLUDED.item_sequence,
            created_by = EXCLUDED.created_by,
            created_at = NOW()
        "#,
        schema::ENROLLMENT_PATH_OVERRIDES
    ))
    .bind(enrollment_id)
    .bind(item_sequence)
    .bind(created_by)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_path_override(pool: &PgPool, enrollment_id: Uuid) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        "DELETE FROM {} WHERE enrollment_id = $1",
        schema::ENROLLMENT_PATH_OVERRIDES
    ))
    .bind(enrollment_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

pub async fn insert_path_event(
    pool: &PgPool,
    enrollment_id: Uuid,
    from_item_id: Option<Uuid>,
    to_item_id: Uuid,
    rule_id: Option<Uuid>,
    was_override: bool,
    was_fallback: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (enrollment_id, from_item_id, to_item_id, rule_id, was_override, was_fallback)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        schema::LEARNER_PATH_EVENTS
    ))
    .bind(enrollment_id)
    .bind(from_item_id)
    .bind(to_item_id)
    .bind(rule_id)
    .bind(was_override)
    .bind(was_fallback)
    .execute(pool)
    .await?;
    Ok(())
}
