use std::borrow::Cow;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course::{CoursePublic, MarkdownThemeCustom};
use crate::repos::course_grants;
use crate::repos::rbac;
use serde_json::Value as JsonValue;

/// Fields for [`update_course`].
pub struct UpdateCourse<'a> {
    pub course_code: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub published: bool,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub visible_from: Option<DateTime<Utc>>,
    pub hidden_at: Option<DateTime<Utc>>,
}

/// Courses the user is enrolled in (any role), including drafts.
pub async fn list_for_enrolled_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<CoursePublic>, sqlx::Error> {
    sqlx::query_as::<_, CoursePublic>(&format!(
        r#"
        SELECT
            c.id,
            c.course_code,
            c.title,
            c.description,
            c.hero_image_url,
            c.hero_image_object_position,
            c.starts_at,
            c.ends_at,
            c.visible_from,
            c.hidden_at,
            c.published,
            c.markdown_theme_preset,
            c.markdown_theme_custom,
            c.grading_scale,
            c.created_at,
            c.updated_at
        FROM {} c
        INNER JOIN {} e ON e.course_id = c.id AND e.user_id = $1
        ORDER BY c.title ASC
        "#,
        schema::COURSES,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await
}

fn new_course_code() -> String {
    let u = Uuid::new_v4();
    let s = u.simple().to_string().to_uppercase();
    format!("C-{}", &s[..6])
}

pub async fn create_course(
    pool: &PgPool,
    title: &str,
    description: &str,
    created_by_user_id: Uuid,
) -> Result<CoursePublic, sqlx::Error> {
    for _ in 0..32 {
        let code = new_course_code();
        let mut tx = pool.begin().await?;
        let result = sqlx::query_as::<_, CoursePublic>(&format!(
            r#"
            INSERT INTO {} (course_code, title, description, published, created_by_user_id)
            VALUES ($1, $2, $3, false, $4)
            RETURNING
                id,
                course_code,
                title,
                description,
                hero_image_url,
                hero_image_object_position,
                starts_at,
                ends_at,
                visible_from,
                hidden_at,
                published,
                markdown_theme_preset,
                markdown_theme_custom,
                grading_scale,
                created_at,
                updated_at
            "#,
            schema::COURSES
        ))
        .bind(&code)
        .bind(title)
        .bind(description)
        .bind(created_by_user_id)
        .fetch_one(&mut *tx)
        .await;

        match result {
            Ok(row) => {
                crate::repos::enrollment::insert_course_creator_teacher(
                    &mut tx,
                    row.id,
                    created_by_user_id,
                )
                .await?;
                let item_perm = course_grants::course_item_create_permission(&row.course_code);
                course_grants::grant_course_permission_string(
                    &mut *tx,
                    created_by_user_id,
                    row.id,
                    &item_perm,
                )
                .await?;
                tx.commit().await?;
                rbac::assign_user_role_by_name(pool, created_by_user_id, "Teacher").await?;
                return Ok(row);
            }
            Err(e) => {
                if let sqlx::Error::Database(ref db) = e {
                    if db.code() == Some(Cow::Borrowed("23505")) {
                        continue;
                    }
                }
                return Err(e);
            }
        }
    }

    Err(sqlx::Error::Io(std::io::Error::other(
        "could not allocate a unique course_code",
    )))
}

pub async fn get_by_course_code(
    pool: &PgPool,
    course_code: &str,
) -> Result<Option<CoursePublic>, sqlx::Error> {
    sqlx::query_as::<_, CoursePublic>(&format!(
        r#"
        SELECT
            id,
            course_code,
            title,
            description,
            hero_image_url,
            hero_image_object_position,
            starts_at,
            ends_at,
            visible_from,
            hidden_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            created_at,
            updated_at
        FROM {}
        WHERE course_code = $1
        "#,
        schema::COURSES
    ))
    .bind(course_code)
    .fetch_optional(pool)
    .await
}

pub async fn get_id_by_course_code(
    pool: &PgPool,
    course_code: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE course_code = $1",
        schema::COURSES
    ))
    .bind(course_code)
    .fetch_optional(pool)
    .await
}

pub async fn update_course(
    pool: &PgPool,
    u: &UpdateCourse<'_>,
) -> Result<Option<CoursePublic>, sqlx::Error> {
    sqlx::query_as::<_, CoursePublic>(&format!(
        r#"
        UPDATE {}
        SET
            title = $1,
            description = $2,
            published = $3,
            starts_at = $4,
            ends_at = $5,
            visible_from = $6,
            hidden_at = $7,
            updated_at = NOW()
        WHERE course_code = $8
        RETURNING
            id,
            course_code,
            title,
            description,
            hero_image_url,
            hero_image_object_position,
            starts_at,
            ends_at,
            visible_from,
            hidden_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            created_at,
            updated_at
        "#,
        schema::COURSES
    ))
    .bind(u.title)
    .bind(u.description)
    .bind(u.published)
    .bind(u.starts_at)
    .bind(u.ends_at)
    .bind(u.visible_from)
    .bind(u.hidden_at)
    .bind(u.course_code)
    .fetch_optional(pool)
    .await
}

pub async fn set_hero_image_fields(
    pool: &PgPool,
    course_code: &str,
    hero_image_url: &str,
    hero_image_object_position: Option<&str>,
) -> Result<Option<CoursePublic>, sqlx::Error> {
    sqlx::query_as::<_, CoursePublic>(&format!(
        r#"
        UPDATE {}
        SET
            hero_image_url = $1,
            hero_image_object_position = $2,
            updated_at = NOW()
        WHERE course_code = $3
        RETURNING
            id,
            course_code,
            title,
            description,
            hero_image_url,
            hero_image_object_position,
            starts_at,
            ends_at,
            visible_from,
            hidden_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            created_at,
            updated_at
        "#,
        schema::COURSES
    ))
    .bind(hero_image_url)
    .bind(hero_image_object_position)
    .bind(course_code)
    .fetch_optional(pool)
    .await
}

pub async fn update_markdown_theme(
    pool: &PgPool,
    course_code: &str,
    preset: &str,
    custom: Option<&MarkdownThemeCustom>,
) -> Result<Option<CoursePublic>, sqlx::Error> {
    let custom_json: Option<JsonValue> =
        custom.map(|c| serde_json::to_value(c).unwrap_or(JsonValue::Null));

    sqlx::query_as::<_, CoursePublic>(&format!(
        r#"
        UPDATE {}
        SET
            markdown_theme_preset = $1,
            markdown_theme_custom = $2,
            updated_at = NOW()
        WHERE course_code = $3
        RETURNING
            id,
            course_code,
            title,
            description,
            hero_image_url,
            hero_image_object_position,
            starts_at,
            ends_at,
            visible_from,
            hidden_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            created_at,
            updated_at
        "#,
        schema::COURSES
    ))
    .bind(preset)
    .bind(custom_json)
    .bind(course_code)
    .fetch_optional(pool)
    .await
}

pub async fn update_hero_fields_optional(
    pool: &PgPool,
    course_code: &str,
    hero_image_url: Option<&str>,
    hero_image_object_position: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET
            hero_image_url = $1,
            hero_image_object_position = $2,
            updated_at = NOW()
        WHERE course_code = $3
        "#,
        schema::COURSES
    ))
    .bind(hero_image_url)
    .bind(hero_image_object_position)
    .bind(course_code)
    .execute(pool)
    .await?;
    Ok(())
}
