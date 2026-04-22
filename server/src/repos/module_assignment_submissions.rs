use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SubmissionRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub module_item_id: Uuid,
    pub submitted_by: Uuid,
    pub attachment_file_id: Option<Uuid>,
    pub submitted_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn get_for_course_item_user(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    submitted_by: Uuid,
) -> Result<Option<SubmissionRow>, sqlx::Error> {
    sqlx::query_as::<_, SubmissionRow>(&format!(
        r#"
        SELECT id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at
        FROM {}
        WHERE course_id = $1 AND module_item_id = $2 AND submitted_by = $3
        "#,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS
    ))
    .bind(course_id)
    .bind(module_item_id)
    .bind(submitted_by)
    .fetch_optional(pool)
    .await
}

pub async fn get_by_id_for_course(
    pool: &PgPool,
    course_id: Uuid,
    submission_id: Uuid,
) -> Result<Option<SubmissionRow>, sqlx::Error> {
    sqlx::query_as::<_, SubmissionRow>(&format!(
        r#"
        SELECT id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at
        FROM {}
        WHERE course_id = $1 AND id = $2
        "#,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS
    ))
    .bind(course_id)
    .bind(submission_id)
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GradedFilter {
    All,
    Graded,
    Ungraded,
}

/// Submissions with no grade row for this assignment item.
pub async fn count_ungraded_for_assignment(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
) -> Result<i64, sqlx::Error> {
    let n: Option<i64> = sqlx::query_scalar(&format!(
        r#"
        SELECT COUNT(*)::bigint
        FROM {tbl} s
        LEFT JOIN {grades} g
          ON g.module_item_id = s.module_item_id AND g.student_user_id = s.submitted_by
        WHERE s.course_id = $1 AND s.module_item_id = $2 AND g.student_user_id IS NULL
        "#,
        tbl = schema::MODULE_ASSIGNMENT_SUBMISSIONS,
        grades = schema::COURSE_GRADES,
    ))
    .bind(course_id)
    .bind(module_item_id)
    .fetch_one(pool)
    .await?;
    Ok(n.unwrap_or(0))
}

pub async fn list_for_assignment(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    filter: GradedFilter,
) -> Result<Vec<SubmissionRow>, sqlx::Error> {
    let graded_clause = match filter {
        GradedFilter::All => "",
        GradedFilter::Graded => "AND g.student_user_id IS NOT NULL",
        GradedFilter::Ungraded => "AND g.student_user_id IS NULL",
    };
    let sql = format!(
        r#"
        SELECT s.id, s.course_id, s.module_item_id, s.submitted_by, s.attachment_file_id, s.submitted_at, s.updated_at
        FROM {tbl} s
        LEFT JOIN {grades} g
          ON g.module_item_id = s.module_item_id AND g.student_user_id = s.submitted_by
        WHERE s.course_id = $1 AND s.module_item_id = $2
        {graded_clause}
        ORDER BY s.submitted_at ASC, s.id ASC
        "#,
        tbl = schema::MODULE_ASSIGNMENT_SUBMISSIONS,
        grades = schema::COURSE_GRADES,
    );
    sqlx::query_as::<_, SubmissionRow>(&sql)
        .bind(course_id)
        .bind(module_item_id)
        .fetch_all(pool)
        .await
}

pub async fn upsert_attachment(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    submitted_by: Uuid,
    attachment_file_id: Uuid,
) -> Result<SubmissionRow, sqlx::Error> {
    sqlx::query_as::<_, SubmissionRow>(&format!(
        r#"
        INSERT INTO {} (course_id, module_item_id, submitted_by, attachment_file_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (module_item_id, submitted_by) DO UPDATE
        SET attachment_file_id = EXCLUDED.attachment_file_id,
            updated_at = NOW()
        RETURNING id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at
        "#,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS
    ))
    .bind(course_id)
    .bind(module_item_id)
    .bind(submitted_by)
    .bind(attachment_file_id)
    .fetch_one(pool)
    .await
}
