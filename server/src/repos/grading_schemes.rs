use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::types::Json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct GradingSchemeRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub name: String,
    pub grading_display_type: String,
    pub scale_json: Option<Json<Value>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn get_active_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Option<GradingSchemeRow>, sqlx::Error> {
    sqlx::query_as::<_, GradingSchemeRow>(&format!(
        r#"
        SELECT s.id, s.course_id, s.name, s.grading_display_type, s.scale_json, s.created_at, s.updated_at
        FROM {} s
        INNER JOIN {} c ON c.grading_scheme_id = s.id
        WHERE c.id = $1
        "#,
        schema::GRADING_SCHEMES,
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_for_course(
    pool: &PgPool,
    course_id: Uuid,
    name: &str,
    grading_display_type: &str,
    scale_json: Value,
) -> Result<GradingSchemeRow, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let scheme_id: Option<Uuid> = sqlx::query_scalar(&format!(
        r#"SELECT grading_scheme_id FROM {} WHERE id = $1 FOR UPDATE"#,
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();

    let row = if let Some(sid) = scheme_id {
        sqlx::query_as::<_, GradingSchemeRow>(&format!(
            r#"
            UPDATE {}
            SET name = $2,
                grading_display_type = $3,
                scale_json = $4,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, course_id, name, grading_display_type, scale_json, created_at, updated_at
            "#,
            schema::GRADING_SCHEMES
        ))
        .bind(sid)
        .bind(name)
        .bind(grading_display_type)
        .bind(&scale_json)
        .fetch_one(&mut *tx)
        .await?
    } else {
        let new_row = sqlx::query_as::<_, GradingSchemeRow>(&format!(
            r#"
            INSERT INTO {} (course_id, name, grading_display_type, scale_json)
            VALUES ($1, $2, $3, $4)
            RETURNING id, course_id, name, grading_display_type, scale_json, created_at, updated_at
            "#,
            schema::GRADING_SCHEMES
        ))
        .bind(course_id)
        .bind(name)
        .bind(grading_display_type)
        .bind(&scale_json)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(&format!(
            r#"UPDATE {} SET grading_scheme_id = $1, updated_at = NOW() WHERE id = $2"#,
            schema::COURSES
        ))
        .bind(new_row.id)
        .bind(course_id)
        .execute(&mut *tx)
        .await?;

        new_row
    };

    tx.commit().await?;
    Ok(row)
}
