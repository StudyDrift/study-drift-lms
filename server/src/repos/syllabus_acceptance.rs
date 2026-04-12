use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

pub async fn has_accepted(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let n: (i64,) = sqlx::query_as(&format!(
        r#"
        SELECT COUNT(*)::bigint
        FROM {}
        WHERE user_id = $1 AND course_id = $2
        "#,
        schema::SYLLABUS_ACCEPTANCES
    ))
    .bind(user_id)
    .bind(course_id)
    .fetch_one(pool)
    .await?;
    Ok(n.0 > 0)
}

pub async fn record(pool: &PgPool, user_id: Uuid, course_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, course_id, accepted_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, course_id) DO NOTHING
        "#,
        schema::SYLLABUS_ACCEPTANCES
    ))
    .bind(user_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(())
}
