use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AnnotationRow {
    pub id: Uuid,
    pub submission_id: Uuid,
    pub annotator_id: Uuid,
    pub client_id: String,
    pub page: i32,
    pub tool_type: String,
    pub colour: String,
    pub coords_json: JsonValue,
    pub body: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

pub async fn list_active_for_submission(
    pool: &PgPool,
    submission_id: Uuid,
) -> Result<Vec<AnnotationRow>, sqlx::Error> {
    sqlx::query_as::<_, AnnotationRow>(&format!(
        r#"
        SELECT id, submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body,
               created_at, updated_at, deleted_at
        FROM {}
        WHERE submission_id = $1 AND deleted_at IS NULL
        ORDER BY page ASC, created_at ASC, id ASC
        "#,
        schema::SUBMISSION_ANNOTATIONS
    ))
    .bind(submission_id)
    .fetch_all(pool)
    .await
}

pub async fn get_by_id(
    pool: &PgPool,
    annotation_id: Uuid,
) -> Result<Option<AnnotationRow>, sqlx::Error> {
    sqlx::query_as::<_, AnnotationRow>(&format!(
        r#"
        SELECT id, submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body,
               created_at, updated_at, deleted_at
        FROM {}
        WHERE id = $1
        "#,
        schema::SUBMISSION_ANNOTATIONS
    ))
    .bind(annotation_id)
    .fetch_optional(pool)
    .await
}

pub struct AnnotationUpsertWrite<'a> {
    pub submission_id: Uuid,
    pub annotator_id: Uuid,
    pub client_id: &'a str,
    pub page: i32,
    pub tool_type: &'a str,
    pub colour: &'a str,
    pub coords_json: JsonValue,
    pub body: Option<&'a str>,
}

pub async fn upsert(
    pool: &PgPool,
    w: AnnotationUpsertWrite<'_>,
) -> Result<AnnotationRow, sqlx::Error> {
    sqlx::query_as::<_, AnnotationRow>(&format!(
        r#"
        INSERT INTO {} (submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (submission_id, annotator_id, client_id) DO UPDATE
        SET page = EXCLUDED.page,
            tool_type = EXCLUDED.tool_type,
            colour = EXCLUDED.colour,
            coords_json = EXCLUDED.coords_json,
            body = EXCLUDED.body,
            deleted_at = NULL,
            updated_at = NOW()
        RETURNING id, submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body,
                  created_at, updated_at, deleted_at
        "#,
        schema::SUBMISSION_ANNOTATIONS
    ))
    .bind(w.submission_id)
    .bind(w.annotator_id)
    .bind(w.client_id)
    .bind(w.page)
    .bind(w.tool_type)
    .bind(w.colour)
    .bind(w.coords_json)
    .bind(w.body)
    .fetch_one(pool)
    .await
}

pub async fn patch_body(
    pool: &PgPool,
    annotation_id: Uuid,
    annotator_id: Uuid,
    body: Option<&str>,
) -> Result<Option<AnnotationRow>, sqlx::Error> {
    sqlx::query_as::<_, AnnotationRow>(&format!(
        r#"
        UPDATE {}
        SET body = $3,
            updated_at = NOW()
        WHERE id = $1 AND annotator_id = $2 AND deleted_at IS NULL
        RETURNING id, submission_id, annotator_id, client_id, page, tool_type, colour, coords_json, body,
                  created_at, updated_at, deleted_at
        "#,
        schema::SUBMISSION_ANNOTATIONS
    ))
    .bind(annotation_id)
    .bind(annotator_id)
    .bind(body)
    .fetch_optional(pool)
    .await
}

pub async fn soft_delete(
    pool: &PgPool,
    annotation_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        "#,
        schema::SUBMISSION_ANNOTATIONS
    ))
    .bind(annotation_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}
