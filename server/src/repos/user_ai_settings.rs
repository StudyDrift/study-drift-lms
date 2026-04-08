use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

pub const DEFAULT_IMAGE_MODEL_ID: &str = "google/gemini-2.5-flash-image";
pub const DEFAULT_COURSE_SETUP_MODEL_ID: &str = "google/gemini-2.0-flash-001";

pub async fn get_image_model_id(pool: &PgPool, user_id: Uuid) -> Result<String, sqlx::Error> {
    let row: Option<(String,)> =
        sqlx::query_as(&format!(
            "SELECT image_model_id FROM {} WHERE user_id = $1",
            schema::USER_AI_SETTINGS
        ))
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(row
        .map(|r| r.0)
        .unwrap_or_else(|| DEFAULT_IMAGE_MODEL_ID.to_string()))
}

pub async fn get_course_setup_model_id(pool: &PgPool, user_id: Uuid) -> Result<String, sqlx::Error> {
    let row: Option<(String,)> =
        sqlx::query_as(&format!(
            "SELECT course_setup_model_id FROM {} WHERE user_id = $1",
            schema::USER_AI_SETTINGS
        ))
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(row
        .map(|r| r.0)
        .unwrap_or_else(|| DEFAULT_COURSE_SETUP_MODEL_ID.to_string()))
}

pub async fn upsert_ai_settings(
    pool: &PgPool,
    user_id: Uuid,
    image_model_id: &str,
    course_setup_model_id: &str,
) -> Result<(String, String), sqlx::Error> {
    let row: (String, String) = sqlx::query_as(
        &format!(
            r#"
        INSERT INTO {} (user_id, image_model_id, course_setup_model_id, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            image_model_id = EXCLUDED.image_model_id,
            course_setup_model_id = EXCLUDED.course_setup_model_id,
            updated_at = NOW()
        RETURNING image_model_id, course_setup_model_id
        "#,
            schema::USER_AI_SETTINGS
        ),
    )
    .bind(user_id)
    .bind(image_model_id)
    .bind(course_setup_model_id)
    .fetch_one(pool)
    .await?;
    Ok(row)
}
