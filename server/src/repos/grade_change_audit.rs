//! Append-only grade change events (plan 3.4 / 3.10).

use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

pub async fn insert(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    student_user_id: Uuid,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    payload: &JsonValue,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, module_item_id, student_user_id, actor_user_id, event_type, payload_json)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        schema::GRADE_CHANGE_AUDIT,
    ))
    .bind(course_id)
    .bind(module_item_id)
    .bind(student_user_id)
    .bind(actor_user_id)
    .bind(event_type)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}
