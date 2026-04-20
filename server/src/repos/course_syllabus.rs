use chrono::{DateTime, Utc};
use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_syllabus::SyllabusSection;

pub async fn get_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Option<(Vec<SyllabusSection>, DateTime<Utc>, bool)>, sqlx::Error> {
    let row: Option<(Json<Vec<SyllabusSection>>, DateTime<Utc>, bool)> = sqlx::query_as(&format!(
        r#"
        SELECT sections, updated_at, require_syllabus_acceptance
        FROM {}
        WHERE course_id = $1
        "#,
        schema::COURSE_SYLLABUS
    ))
    .bind(course_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(j, t, r)| (j.0, t, r)))
}

/// Sections and updated time only (backward compatible for merge helpers).
pub async fn get_sections(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Option<(Vec<SyllabusSection>, DateTime<Utc>)>, sqlx::Error> {
    let row = get_for_course(pool, course_id).await?;
    Ok(row.map(|(s, t, _)| (s, t)))
}

pub async fn upsert_syllabus(
    pool: &PgPool,
    course_id: Uuid,
    sections: &[SyllabusSection],
    require_syllabus_acceptance: bool,
) -> Result<DateTime<Utc>, sqlx::Error> {
    let json = Json(sections.to_vec());
    let updated: DateTime<Utc> = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} AS s (course_id, sections, require_syllabus_acceptance, updated_at)
        VALUES ($1, $2::jsonb, $3, NOW())
        ON CONFLICT (course_id) DO UPDATE
        SET sections = EXCLUDED.sections,
            require_syllabus_acceptance = EXCLUDED.require_syllabus_acceptance,
            settings_version = s.settings_version + 1,
            updated_at = NOW()
        RETURNING updated_at
        "#,
        schema::COURSE_SYLLABUS
    ))
    .bind(course_id)
    .bind(json)
    .bind(require_syllabus_acceptance)
    .fetch_one(pool)
    .await?;
    Ok(updated)
}

/// Updates sections only; keeps existing `require_syllabus_acceptance` when a row exists.
pub async fn upsert_sections(
    pool: &PgPool,
    course_id: Uuid,
    sections: &[SyllabusSection],
) -> Result<DateTime<Utc>, sqlx::Error> {
    let require = get_for_course(pool, course_id)
        .await?
        .map(|(_, _, r)| r)
        .unwrap_or(false);
    upsert_syllabus(pool, course_id, sections, require).await
}
