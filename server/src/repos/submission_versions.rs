//! Archived submission file snapshots (plan 3.13) before each resubmission.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SubmissionVersionRow {
    pub id: Uuid,
    pub version_number: i32,
    pub attachment_file_id: Option<Uuid>,
    pub submitted_at: DateTime<Utc>,
}

pub async fn list_for_student_item(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    student_id: Uuid,
) -> Result<Vec<SubmissionVersionRow>, sqlx::Error> {
    sqlx::query_as::<_, SubmissionVersionRow>(&format!(
        r#"
        SELECT id, version_number, attachment_file_id, submitted_at
        FROM {}
        WHERE course_id = $1 AND module_item_id = $2 AND student_id = $3
        ORDER BY version_number ASC, id ASC
        "#,
        schema::SUBMISSION_VERSIONS
    ))
    .bind(course_id)
    .bind(module_item_id)
    .bind(student_id)
    .fetch_all(pool)
    .await
}

pub async fn insert_archived(
    conn: &mut PgConnection,
    course_id: Uuid,
    module_item_id: Uuid,
    student_id: Uuid,
    version_number: i32,
    attachment_file_id: Option<Uuid>,
    submitted_at: DateTime<Utc>,
) -> Result<Uuid, sqlx::Error> {
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (course_id, module_item_id, student_id, version_number, attachment_file_id, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
        schema::SUBMISSION_VERSIONS
    ))
    .bind(course_id)
    .bind(module_item_id)
    .bind(student_id)
    .bind(version_number)
    .bind(attachment_file_id)
    .bind(submitted_at)
    .fetch_one(conn)
    .await?;
    Ok(id)
}
