//! Per-enrollment overrides for a specific quiz (`course.enrollment_quiz_overrides`).

use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

pub async fn get_extra_attempts_for_enrollment_quiz(
    pool: &PgPool,
    enrollment_id: Uuid,
    quiz_structure_item_id: Uuid,
) -> Result<i32, sqlx::Error> {
    let row: Option<(i32,)> = sqlx::query_as(&format!(
        r#"
        SELECT extra_attempts FROM {}
        WHERE enrollment_id = $1 AND quiz_id = $2
        "#,
        schema::ENROLLMENT_QUIZ_OVERRIDES
    ))
    .bind(enrollment_id)
    .bind(quiz_structure_item_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(n,)| n).unwrap_or(0).max(0))
}

#[derive(Debug, Clone)]
pub struct EnrollmentQuizOverrideWrite {
    pub extra_attempts: i32,
    pub time_multiplier: Option<f64>,
}

pub async fn upsert_override(
    pool: &PgPool,
    enrollment_id: Uuid,
    quiz_structure_item_id: Uuid,
    created_by: Uuid,
    w: &EnrollmentQuizOverrideWrite,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (enrollment_id, quiz_id, extra_attempts, time_multiplier, created_by)
        VALUES ($1, $2, $3, $4::numeric, $5)
        ON CONFLICT (enrollment_id, quiz_id) DO UPDATE SET
            extra_attempts = EXCLUDED.extra_attempts,
            time_multiplier = EXCLUDED.time_multiplier,
            created_by = EXCLUDED.created_by
        "#,
        schema::ENROLLMENT_QUIZ_OVERRIDES
    ))
    .bind(enrollment_id)
    .bind(quiz_structure_item_id)
    .bind(w.extra_attempts.max(0))
    .bind(w.time_multiplier)
    .bind(created_by)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_override(
    pool: &PgPool,
    enrollment_id: Uuid,
    quiz_structure_item_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE enrollment_id = $1 AND quiz_id = $2"#,
        schema::ENROLLMENT_QUIZ_OVERRIDES
    ))
    .bind(enrollment_id)
    .bind(quiz_structure_item_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}
