use std::collections::HashMap;
use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use sqlx::PgPool;
use sqlx::Postgres;
use sqlx::Transaction;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone)]
pub struct CourseItemAssignmentRow {
    pub title: String,
    pub markdown: String,
    pub due_at: Option<DateTime<Utc>>,
    pub points_worth: Option<i32>,
    pub assignment_group_id: Option<Uuid>,
    pub updated_at: DateTime<Utc>,
    pub available_from: Option<DateTime<Utc>>,
    pub available_until: Option<DateTime<Utc>>,
    pub assignment_access_code: Option<String>,
    pub submission_allow_text: bool,
    pub submission_allow_file_upload: bool,
    pub submission_allow_url: bool,
}

#[derive(Debug, Clone)]
pub struct AssignmentBodyWrite {
    pub markdown: String,
    pub points_worth: Option<i32>,
    pub available_from: Option<DateTime<Utc>>,
    pub available_until: Option<DateTime<Utc>>,
    /// `None` stores SQL NULL (no access code).
    pub assignment_access_code: Option<String>,
    pub submission_allow_text: bool,
    pub submission_allow_file_upload: bool,
    pub submission_allow_url: bool,
}

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
    type RowTuple = (
        String,
        String,
        Option<DateTime<Utc>>,
        Option<i32>,
        Option<Uuid>,
        DateTime<Utc>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<String>,
        bool,
        bool,
        bool,
    );
    let row: Option<RowTuple> = sqlx::query_as(&format!(
        r#"
        SELECT c.title, m.markdown, c.due_at, m.points_worth, c.assignment_group_id, m.updated_at,
               m.available_from, m.available_until, m.assignment_access_code,
               m.submission_allow_text, m.submission_allow_file_upload, m.submission_allow_url
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

    Ok(row.map(
        |(
            title,
            markdown,
            due_at,
            points_worth,
            assignment_group_id,
            updated_at,
            available_from,
            available_until,
            assignment_access_code,
            submission_allow_text,
            submission_allow_file_upload,
            submission_allow_url,
        )| CourseItemAssignmentRow {
            title,
            markdown,
            due_at,
            points_worth,
            assignment_group_id,
            updated_at,
            available_from,
            available_until,
            assignment_access_code,
            submission_allow_text,
            submission_allow_file_upload,
            submission_allow_url,
        },
    ))
}

pub async fn write_assignment_body(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    body: &AssignmentBodyWrite,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET markdown = $3,
            points_worth = $4,
            available_from = $5,
            available_until = $6,
            assignment_access_code = $7,
            submission_allow_text = $8,
            submission_allow_file_upload = $9,
            submission_allow_url = $10,
            updated_at = NOW()
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
    .bind(&body.markdown)
    .bind(body.points_worth)
    .bind(body.available_from)
    .bind(body.available_until)
    .bind(body.assignment_access_code.as_deref())
    .bind(body.submission_allow_text)
    .bind(body.submission_allow_file_upload)
    .bind(body.submission_allow_url)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_import_body(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
    points_worth: Option<i32>,
    available_from: Option<DateTime<Utc>>,
    available_until: Option<DateTime<Utc>>,
    assignment_access_code: Option<&str>,
    submission_allow_text: bool,
    submission_allow_file_upload: bool,
    submission_allow_url: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            structure_item_id, markdown, points_worth, updated_at,
            available_from, available_until, assignment_access_code,
            submission_allow_text, submission_allow_file_upload, submission_allow_url
        )
        SELECT c.id, $3, $4, NOW(), $5, $6, $7, $8, $9, $10
        FROM {} c
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
        ON CONFLICT (structure_item_id) DO UPDATE
        SET markdown = EXCLUDED.markdown,
            points_worth = EXCLUDED.points_worth,
            available_from = EXCLUDED.available_from,
            available_until = EXCLUDED.available_until,
            assignment_access_code = EXCLUDED.assignment_access_code,
            submission_allow_text = EXCLUDED.submission_allow_text,
            submission_allow_file_upload = EXCLUDED.submission_allow_file_upload,
            submission_allow_url = EXCLUDED.submission_allow_url,
            updated_at = NOW()
        "#,
        schema::MODULE_ASSIGNMENTS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .bind(points_worth)
    .bind(available_from)
    .bind(available_until)
    .bind(assignment_access_code)
    .bind(submission_allow_text)
    .bind(submission_allow_file_upload)
    .bind(submission_allow_url)
    .execute(pool)
    .await?;
    Ok(())
}
