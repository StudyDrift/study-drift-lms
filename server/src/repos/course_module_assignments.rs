use std::collections::HashMap;
use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use sqlx::PgPool;
use sqlx::Postgres;
use sqlx::Transaction;
use uuid::Uuid;

use crate::db::schema;

type CourseItemAssignmentRow = (
    String,
    String,
    Option<DateTime<Utc>>,
    Option<i32>,
    Option<Uuid>,
    DateTime<Utc>,
);

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

/// `points_worth` from `module_assignments` for structure outline rows.
pub async fn points_worth_for_structure_items(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_ids: &[Uuid],
) -> Result<HashMap<Uuid, Option<i32>>, sqlx::Error> {
    if structure_item_ids.is_empty() {
        return Ok(HashMap::new());
    }
    #[derive(Debug, Clone, FromRow)]
    struct Row {
        id: Uuid,
        points_worth: Option<i32>,
    }
    let rows: Vec<Row> = sqlx::query_as(&format!(
        r#"
        SELECT c.id, m.points_worth
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.course_id = $1 AND c.kind = 'assignment' AND c.id = ANY($2)
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(course_id)
    .bind(structure_item_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| (r.id, r.points_worth)).collect())
}

pub async fn get_for_course_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CourseItemAssignmentRow>, sqlx::Error> {
    let row: Option<CourseItemAssignmentRow> = sqlx::query_as(&format!(
        r#"
        SELECT c.title, m.markdown, c.due_at, m.points_worth, c.assignment_group_id, m.updated_at
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

pub async fn update_markdown_and_points(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
    points_worth: Option<i32>,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET markdown = $3, points_worth = $4, updated_at = NOW()
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
    .bind(points_worth)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_import_body(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
    points_worth: Option<i32>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, markdown, points_worth, updated_at)
        SELECT c.id, $3, $4, NOW()
        FROM {} c
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
        ON CONFLICT (structure_item_id) DO UPDATE
        SET markdown = EXCLUDED.markdown,
            points_worth = EXCLUDED.points_worth,
            updated_at = NOW()
        "#,
        schema::MODULE_ASSIGNMENTS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .bind(points_worth)
    .execute(pool)
    .await?;
    Ok(())
}
