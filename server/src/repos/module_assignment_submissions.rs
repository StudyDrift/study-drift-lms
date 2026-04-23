use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::db::schema;
use crate::repos::submission_versions;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SubmissionRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub module_item_id: Uuid,
    pub submitted_by: Uuid,
    pub attachment_file_id: Option<Uuid>,
    pub submitted_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub resubmission_requested: bool,
    pub revision_due_at: Option<DateTime<Utc>>,
    pub revision_feedback: Option<String>,
    pub version_number: i32,
}

pub async fn get_for_course_item_user(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    submitted_by: Uuid,
) -> Result<Option<SubmissionRow>, sqlx::Error> {
    sqlx::query_as::<_, SubmissionRow>(&format!(
        r#"
        SELECT id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at,
               resubmission_requested, revision_due_at, revision_feedback, version_number
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

pub async fn get_by_id(pool: &PgPool, submission_id: Uuid) -> Result<Option<SubmissionRow>, sqlx::Error> {
    sqlx::query_as::<_, SubmissionRow>(&format!(
        r#"
        SELECT id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at,
               resubmission_requested, revision_due_at, revision_feedback, version_number
        FROM {}
        WHERE id = $1
        "#,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS
    ))
    .bind(submission_id)
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
        SELECT id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at,
               resubmission_requested, revision_due_at, revision_feedback, version_number
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
        SELECT s.id, s.course_id, s.module_item_id, s.submitted_by, s.attachment_file_id, s.submitted_at, s.updated_at,
               s.resubmission_requested, s.revision_due_at, s.revision_feedback, s.version_number
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
        RETURNING id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at,
                  resubmission_requested, revision_due_at, revision_feedback, version_number
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

/// Archive the current file as a version and attach the new file, clearing revision state.
/// Returns `None` if the row is not open for resubmission (deadline, cap, or flag).
pub async fn resubmit_versioned_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    now: DateTime<Utc>,
    course_id: Uuid,
    submission_id: Uuid,
    new_attachment_file_id: Uuid,
) -> Result<Option<SubmissionRow>, sqlx::Error> {
    let cur: Option<SubmissionRow> = sqlx::query_as(&format!(
        r#"
        SELECT id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at,
               resubmission_requested, revision_due_at, revision_feedback, version_number
        FROM {}
        WHERE course_id = $1 AND id = $2
        FOR UPDATE
        "#,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS
    ))
    .bind(course_id)
    .bind(submission_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(s) = cur else {
        return Ok(None);
    };
    if !s.resubmission_requested {
        return Ok(None);
    }
    if let Some(d) = s.revision_due_at {
        if d < now {
            return Ok(None);
        }
    }
    if s.version_number >= 10 {
        return Ok(None);
    }

    submission_versions::insert_archived(
        &mut *tx,
        s.course_id,
        s.module_item_id,
        s.submitted_by,
        s.version_number,
        s.attachment_file_id,
        s.submitted_at,
    )
    .await?;

    let next_v = s.version_number + 1;
    let updated = sqlx::query_as::<_, SubmissionRow>(&format!(
        r#"
        UPDATE {}
        SET attachment_file_id = $1,
            submitted_at = $2,
            updated_at = $2,
            version_number = $3,
            resubmission_requested = false,
            revision_due_at = NULL,
            revision_feedback = NULL
        WHERE id = $4
        RETURNING id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at,
                  resubmission_requested, revision_due_at, revision_feedback, version_number
        "#,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS
    ))
    .bind(new_attachment_file_id)
    .bind(now)
    .bind(next_v)
    .bind(s.id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(Some(updated))
}

async fn set_revision_request_executor<'e, E>(
    ex: E,
    course_id: Uuid,
    submission_id: Uuid,
    revision_due_at: Option<DateTime<Utc>>,
    revision_feedback: Option<&str>,
) -> Result<Option<SubmissionRow>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_as::<_, SubmissionRow>(&format!(
        r#"
        UPDATE {}
        SET resubmission_requested = true,
            revision_due_at = $1,
            revision_feedback = $2,
            updated_at = NOW()
        WHERE course_id = $3 AND id = $4
        RETURNING id, course_id, module_item_id, submitted_by, attachment_file_id, submitted_at, updated_at,
                  resubmission_requested, revision_due_at, revision_feedback, version_number
        "#,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS
    ))
    .bind(revision_due_at)
    .bind(revision_feedback)
    .bind(course_id)
    .bind(submission_id)
    .fetch_optional(ex)
    .await
}

pub async fn set_revision_request(
    pool: &PgPool,
    course_id: Uuid,
    submission_id: Uuid,
    revision_due_at: Option<DateTime<Utc>>,
    revision_feedback: Option<&str>,
) -> Result<Option<SubmissionRow>, sqlx::Error> {
    set_revision_request_executor(
        pool,
        course_id,
        submission_id,
        revision_due_at,
        revision_feedback,
    )
    .await
}

pub async fn set_revision_request_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    course_id: Uuid,
    submission_id: Uuid,
    revision_due_at: Option<DateTime<Utc>>,
    revision_feedback: Option<&str>,
) -> Result<Option<SubmissionRow>, sqlx::Error> {
    set_revision_request_executor(
        &mut **tx,
        course_id,
        submission_id,
        revision_due_at,
        revision_feedback,
    )
    .await
}
