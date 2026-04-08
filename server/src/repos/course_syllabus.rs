use chrono::{DateTime, Utc};
use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_syllabus::SyllabusSection;

pub async fn get_sections(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Option<(Vec<SyllabusSection>, DateTime<Utc>)>, sqlx::Error> {
    let row: Option<(Json<Vec<SyllabusSection>>, DateTime<Utc>)> = sqlx::query_as(&format!(
        r#"
        SELECT sections, updated_at
        FROM {}
        WHERE course_id = $1
        "#,
        schema::COURSE_SYLLABUS
    ))
    .bind(course_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(j, t)| (j.0, t)))
}

pub async fn upsert_sections(
    pool: &PgPool,
    course_id: Uuid,
    sections: &[SyllabusSection],
) -> Result<DateTime<Utc>, sqlx::Error> {
    let json = Json(sections.to_vec());
    let updated: DateTime<Utc> = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (course_id, sections, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (course_id) DO UPDATE
        SET sections = EXCLUDED.sections, updated_at = NOW()
        RETURNING updated_at
        "#,
        schema::COURSE_SYLLABUS
    ))
    .bind(course_id)
    .bind(json)
    .fetch_one(pool)
    .await?;
    Ok(updated)
}
