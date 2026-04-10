use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::Postgres;
use sqlx::Transaction;
use uuid::Uuid;

use crate::db::schema;

type CourseItemContentRow = (String, String, Option<DateTime<Utc>>, DateTime<Utc>);

pub async fn insert_empty_for_item(
    tx: &mut Transaction<'_, Postgres>,
    structure_item_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, markdown, updated_at)
        VALUES ($1, '', NOW())
        "#,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(structure_item_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn get_for_course_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CourseItemContentRow>, sqlx::Error> {
    let row: Option<CourseItemContentRow> = sqlx::query_as(&format!(
        r#"
        SELECT c.title, m.markdown, c.due_at, m.updated_at
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn update_markdown(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET markdown = $3, updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'assignment'
        RETURNING m.updated_at
        "#,
        schema::MODULE_ASSIGNMENTS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_import_body(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, markdown, updated_at)
        SELECT c.id, $3, NOW()
        FROM {} c
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
        ON CONFLICT (structure_item_id) DO UPDATE
        SET markdown = EXCLUDED.markdown, updated_at = NOW()
        "#,
        schema::MODULE_ASSIGNMENTS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .execute(pool)
    .await?;
    Ok(())
}
