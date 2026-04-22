//! Provisional grader scores before moderator reconciliation (plan 3.4).

use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ProvisionalGradeRow {
    pub id: Uuid,
    pub submission_id: Uuid,
    pub grader_id: Uuid,
    pub score: f64,
    pub rubric_data: Option<JsonValue>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_for_assignment(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
) -> Result<Vec<ProvisionalGradeRow>, sqlx::Error> {
    sqlx::query_as::<_, ProvisionalGradeRow>(&format!(
        r#"
        SELECT pg.id, pg.submission_id, pg.grader_id, pg.score, pg.rubric_data, pg.submitted_at,
               pg.created_at, pg.updated_at
        FROM {} pg
        INNER JOIN {} s ON s.id = pg.submission_id
        WHERE s.course_id = $1 AND s.module_item_id = $2
        ORDER BY pg.submission_id, pg.grader_id
        "#,
        schema::PROVISIONAL_GRADES,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS,
    ))
    .bind(course_id)
    .bind(module_item_id)
    .fetch_all(pool)
    .await
}

pub async fn list_for_submission(
    pool: &PgPool,
    course_id: Uuid,
    submission_id: Uuid,
) -> Result<Vec<ProvisionalGradeRow>, sqlx::Error> {
    sqlx::query_as::<_, ProvisionalGradeRow>(&format!(
        r#"
        SELECT pg.id, pg.submission_id, pg.grader_id, pg.score, pg.rubric_data, pg.submitted_at,
               pg.created_at, pg.updated_at
        FROM {} pg
        INNER JOIN {} s ON s.id = pg.submission_id
        WHERE s.course_id = $1 AND pg.submission_id = $2
        ORDER BY pg.grader_id
        "#,
        schema::PROVISIONAL_GRADES,
        schema::MODULE_ASSIGNMENT_SUBMISSIONS,
    ))
    .bind(course_id)
    .bind(submission_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert(
    pool: &PgPool,
    submission_id: Uuid,
    grader_id: Uuid,
    score: f64,
    rubric_data: Option<&JsonValue>,
) -> Result<ProvisionalGradeRow, sqlx::Error> {
    let now = Utc::now();
    sqlx::query_as::<_, ProvisionalGradeRow>(&format!(
        r#"
        INSERT INTO {} (submission_id, grader_id, score, rubric_data, submitted_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $5, $5)
        ON CONFLICT (submission_id, grader_id)
        DO UPDATE SET
            score = EXCLUDED.score,
            rubric_data = EXCLUDED.rubric_data,
            submitted_at = EXCLUDED.submitted_at,
            updated_at = EXCLUDED.updated_at
        RETURNING id, submission_id, grader_id, score, rubric_data, submitted_at, created_at, updated_at
        "#,
        schema::PROVISIONAL_GRADES,
    ))
    .bind(submission_id)
    .bind(grader_id)
    .bind(score)
    .bind(rubric_data)
    .bind(now)
    .fetch_one(pool)
    .await
}
