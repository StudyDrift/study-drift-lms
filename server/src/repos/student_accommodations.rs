//! `course.student_accommodations` — per-learner operational accommodation settings.

use crate::db::schema;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct StudentAccommodationRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub course_id: Option<Uuid>,
    pub time_multiplier: f64,
    pub extra_attempts: i32,
    pub hints_always_enabled: bool,
    pub reduced_distraction_mode: bool,
    pub alternative_format: Option<String>,
    pub effective_from: Option<NaiveDate>,
    pub effective_until: Option<NaiveDate>,
    pub created_by: Uuid,
    pub updated_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct StudentAccommodationRowDb {
    id: Uuid,
    user_id: Uuid,
    course_id: Option<Uuid>,
    time_multiplier: f64,
    extra_attempts: i32,
    hints_always_enabled: bool,
    reduced_distraction_mode: bool,
    alternative_format: Option<String>,
    effective_from: Option<NaiveDate>,
    effective_until: Option<NaiveDate>,
    created_by: Uuid,
    updated_by: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<StudentAccommodationRowDb> for StudentAccommodationRow {
    fn from(r: StudentAccommodationRowDb) -> Self {
        StudentAccommodationRow {
            id: r.id,
            user_id: r.user_id,
            course_id: r.course_id,
            time_multiplier: r.time_multiplier,
            extra_attempts: r.extra_attempts,
            hints_always_enabled: r.hints_always_enabled,
            reduced_distraction_mode: r.reduced_distraction_mode,
            alternative_format: r.alternative_format,
            effective_from: r.effective_from,
            effective_until: r.effective_until,
            created_by: r.created_by,
            updated_by: r.updated_by,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StudentAccommodationListRow {
    pub row: StudentAccommodationRow,
    pub course_code: Option<String>,
}

#[derive(sqlx::FromRow)]
struct StudentAccommodationListRowDb {
    #[sqlx(flatten)]
    base: StudentAccommodationRowDb,
    course_code: Option<String>,
}

pub async fn list_for_user_with_course(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<StudentAccommodationListRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, StudentAccommodationListRowDb>(&format!(
        r#"
        SELECT sa.id, sa.user_id, sa.course_id,
               (sa.time_multiplier)::double precision AS time_multiplier,
               sa.extra_attempts, sa.hints_always_enabled, sa.reduced_distraction_mode,
               sa.alternative_format, sa.effective_from, sa.effective_until,
               sa.created_by, sa.updated_by, sa.created_at, sa.updated_at,
               c.course_code AS course_code
        FROM {} sa
        LEFT JOIN {} c ON c.id = sa.course_id
        WHERE sa.user_id = $1
        ORDER BY sa.course_id NULLS LAST, sa.created_at ASC
        "#,
        schema::STUDENT_ACCOMMODATIONS,
        schema::COURSES
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| StudentAccommodationListRow {
            row: r.base.into(),
            course_code: r.course_code,
        })
        .collect())
}

pub async fn get_by_id_for_user(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<StudentAccommodationRow>, sqlx::Error> {
    sqlx::query_as::<_, StudentAccommodationRowDb>(&format!(
        r#"
        SELECT id, user_id, course_id,
               (time_multiplier)::double precision AS time_multiplier,
               extra_attempts, hints_always_enabled, reduced_distraction_mode,
               alternative_format, effective_from, effective_until,
               created_by, updated_by, created_at, updated_at
        FROM {}
        WHERE id = $1 AND user_id = $2
        "#,
        schema::STUDENT_ACCOMMODATIONS
    ))
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map(|o| o.map(Into::into))
}

pub async fn find_active_for_course(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
) -> Result<Option<StudentAccommodationRow>, sqlx::Error> {
    sqlx::query_as::<_, StudentAccommodationRowDb>(&format!(
        r#"
        SELECT id, user_id, course_id,
               (time_multiplier)::double precision AS time_multiplier,
               extra_attempts, hints_always_enabled, reduced_distraction_mode,
               alternative_format, effective_from, effective_until,
               created_by, updated_by, created_at, updated_at
        FROM {}
        WHERE user_id = $1 AND course_id = $2
          AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
          AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
        LIMIT 1
        "#,
        schema::STUDENT_ACCOMMODATIONS
    ))
    .bind(user_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await
    .map(|o| o.map(Into::into))
}

pub async fn find_active_global(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<StudentAccommodationRow>, sqlx::Error> {
    sqlx::query_as::<_, StudentAccommodationRowDb>(&format!(
        r#"
        SELECT id, user_id, course_id,
               (time_multiplier)::double precision AS time_multiplier,
               extra_attempts, hints_always_enabled, reduced_distraction_mode,
               alternative_format, effective_from, effective_until,
               created_by, updated_by, created_at, updated_at
        FROM {}
        WHERE user_id = $1 AND course_id IS NULL
          AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
          AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
        LIMIT 1
        "#,
        schema::STUDENT_ACCOMMODATIONS
    ))
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map(|o| o.map(Into::into))
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_row(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Option<Uuid>,
    time_multiplier: f64,
    extra_attempts: i32,
    hints_always_enabled: bool,
    reduced_distraction_mode: bool,
    alternative_format: Option<&str>,
    effective_from: Option<NaiveDate>,
    effective_until: Option<NaiveDate>,
    created_by: Uuid,
) -> Result<StudentAccommodationRow, sqlx::Error> {
    let row = sqlx::query_as::<_, StudentAccommodationRowDb>(&format!(
        r#"
        INSERT INTO {} (
            user_id, course_id, time_multiplier, extra_attempts,
            hints_always_enabled, reduced_distraction_mode, alternative_format,
            effective_from, effective_until, created_by, updated_by
        )
        VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9, $10, $10)
        RETURNING id, user_id, course_id,
                  (time_multiplier)::double precision AS time_multiplier,
                  extra_attempts, hints_always_enabled, reduced_distraction_mode,
                  alternative_format, effective_from, effective_until,
                  created_by, updated_by, created_at, updated_at
        "#,
        schema::STUDENT_ACCOMMODATIONS
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(time_multiplier)
    .bind(extra_attempts)
    .bind(hints_always_enabled)
    .bind(reduced_distraction_mode)
    .bind(alternative_format)
    .bind(effective_from)
    .bind(effective_until)
    .bind(created_by)
    .fetch_one(pool)
    .await?;
    Ok(row.into())
}

#[allow(clippy::too_many_arguments)]
pub async fn update_row(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    time_multiplier: f64,
    extra_attempts: i32,
    hints_always_enabled: bool,
    reduced_distraction_mode: bool,
    alternative_format: Option<&str>,
    effective_from: Option<NaiveDate>,
    effective_until: Option<NaiveDate>,
    updated_by: Uuid,
) -> Result<Option<StudentAccommodationRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, StudentAccommodationRowDb>(&format!(
        r#"
        UPDATE {}
        SET time_multiplier = $3::numeric,
            extra_attempts = $4,
            hints_always_enabled = $5,
            reduced_distraction_mode = $6,
            alternative_format = $7,
            effective_from = $8,
            effective_until = $9,
            updated_by = $10,
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, user_id, course_id,
                  (time_multiplier)::double precision AS time_multiplier,
                  extra_attempts, hints_always_enabled, reduced_distraction_mode,
                  alternative_format, effective_from, effective_until,
                  created_by, updated_by, created_at, updated_at
        "#,
        schema::STUDENT_ACCOMMODATIONS
    ))
    .bind(id)
    .bind(user_id)
    .bind(time_multiplier)
    .bind(extra_attempts)
    .bind(hints_always_enabled)
    .bind(reduced_distraction_mode)
    .bind(alternative_format)
    .bind(effective_from)
    .bind(effective_until)
    .bind(updated_by)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(Into::into))
}

pub async fn delete_row(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $1 AND user_id = $2"#,
        schema::STUDENT_ACCOMMODATIONS
    ))
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}
