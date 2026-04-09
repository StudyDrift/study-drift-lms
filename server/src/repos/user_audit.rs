use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

pub async fn structure_item_is_course_content_page(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {}
            WHERE id = $1 AND course_id = $2 AND kind = 'content_page'
        )
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(structure_item_id)
    .bind(course_id)
    .fetch_one(pool)
    .await
}

pub async fn insert(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    structure_item_id: Option<Uuid>,
    event_kind: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, course_id, structure_item_id, event_kind, occurred_at)
        VALUES ($1, $2, $3, $4, NOW())
        "#,
        schema::USER_AUDIT
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(structure_item_id)
    .bind(event_kind)
    .execute(pool)
    .await?;
    Ok(())
}
