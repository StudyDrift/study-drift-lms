use std::borrow::Cow;
use std::collections::HashSet;

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
    pub schedule_mode: &'a str,
    pub relative_end_after: Option<&'a str>,
    pub relative_hidden_after: Option<&'a str>,
    pub relative_schedule_anchor_at: Option<DateTime<Utc>>,
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
            c.schedule_mode,
            c.relative_end_after,
            c.relative_hidden_after,
            c.relative_schedule_anchor_at,
            c.published,
            c.markdown_theme_preset,
            c.markdown_theme_custom,
            c.grading_scale,
            c.archived,
            c.notebook_enabled,
            c.feed_enabled,
            c.calendar_enabled,
            c.question_bank_enabled,
            c.lockdown_mode_enabled,
            c.standards_alignment_enabled,
            c.adaptive_paths_enabled,
            c.srs_enabled,
            c.diagnostic_assessments_enabled,
            c.hint_scaffolding_enabled,
            c.created_at,
            c.updated_at
        FROM {} c
        LEFT JOIN {} o ON o.user_id = $1 AND o.course_id = c.id
        WHERE c.id IN (SELECT e.course_id FROM {} e WHERE e.user_id = $1)
          AND c.archived = false
        ORDER BY o.sort_order NULLS LAST, c.title ASC
        "#,
        schema::COURSES,
        schema::USER_COURSE_CATALOG_ORDER,
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

pub async fn insert_course(
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
                schedule_mode,
                relative_end_after,
                relative_hidden_after,
                relative_schedule_anchor_at,
                published,
                markdown_theme_preset,
                markdown_theme_custom,
                grading_scale,
                archived,
                notebook_enabled,
                feed_enabled,
                calendar_enabled,
                question_bank_enabled,
                lockdown_mode_enabled,
                standards_alignment_enabled,
                adaptive_paths_enabled,
                srs_enabled,
                diagnostic_assessments_enabled,
                hint_scaffolding_enabled,
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
                let items_perm = course_grants::course_items_create_permission(&row.course_code);
                course_grants::grant_course_permission_string(
                    &mut *tx,
                    created_by_user_id,
                    row.id,
                    &items_perm,
                )
                .await?;
                let enroll_read =
                    course_grants::course_enrollments_read_permission(&row.course_code);
                course_grants::grant_course_permission_string(
                    &mut *tx,
                    created_by_user_id,
                    row.id,
                    &enroll_read,
                )
                .await?;
                sqlx::query(&format!(
                    r#"
                    INSERT INTO {} (course_id, sort_order, name, weight_percent)
                    VALUES ($1, 0, 'Assignments', 100.0)
                    "#,
                    schema::ASSIGNMENT_GROUPS
                ))
                .bind(row.id)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
                rbac::assign_user_role_by_name(pool, created_by_user_id, "Teacher").await?;
                rbac::assign_user_role_by_name(pool, created_by_user_id, "Global Admin").await?;
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
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            archived,
            notebook_enabled,
            feed_enabled,
            calendar_enabled,
            question_bank_enabled,
            lockdown_mode_enabled,
            standards_alignment_enabled,
            adaptive_paths_enabled,
            srs_enabled,
            diagnostic_assessments_enabled,
            hint_scaffolding_enabled,
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

pub async fn get_by_id(
    pool: &PgPool,
    course_id: Uuid,
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
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            archived,
            notebook_enabled,
            feed_enabled,
            calendar_enabled,
            question_bank_enabled,
            lockdown_mode_enabled,
            standards_alignment_enabled,
            adaptive_paths_enabled,
            srs_enabled,
            diagnostic_assessments_enabled,
            hint_scaffolding_enabled,
            created_at,
            updated_at
        FROM {}
        WHERE id = $1
        "#,
        schema::COURSES
    ))
    .bind(course_id)
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

pub async fn get_course_code_by_id(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(&format!(
        "SELECT course_code FROM {} WHERE id = $1",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_created_by_user_id(
    pool: &PgPool,
    course_code: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT created_by_user_id FROM {} WHERE course_code = $1",
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
            schedule_mode = $8,
            relative_end_after = $9,
            relative_hidden_after = $10,
            relative_schedule_anchor_at = $11,
            updated_at = NOW()
        WHERE course_code = $12
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
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            archived,
            notebook_enabled,
            feed_enabled,
            calendar_enabled,
            question_bank_enabled,
            lockdown_mode_enabled,
            standards_alignment_enabled,
            adaptive_paths_enabled,
            srs_enabled,
            diagnostic_assessments_enabled,
            hint_scaffolding_enabled,
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
    .bind(u.schedule_mode)
    .bind(u.relative_end_after)
    .bind(u.relative_hidden_after)
    .bind(u.relative_schedule_anchor_at)
    .bind(u.course_code)
    .fetch_optional(pool)
    .await
}

pub async fn patch_course_features(
    pool: &PgPool,
    course_code: &str,
    notebook_enabled: bool,
    feed_enabled: bool,
    calendar_enabled: bool,
    question_bank_enabled: bool,
    lockdown_mode_enabled: bool,
    standards_alignment_enabled: bool,
    adaptive_paths_enabled: bool,
    srs_enabled: bool,
    diagnostic_assessments_enabled: bool,
    hint_scaffolding_enabled: bool,
) -> Result<Option<CoursePublic>, sqlx::Error> {
    sqlx::query_as::<_, CoursePublic>(&format!(
        r#"
        UPDATE {}
        SET
            notebook_enabled = $1,
            feed_enabled = $2,
            calendar_enabled = $3,
            question_bank_enabled = $4,
            lockdown_mode_enabled = $5,
            standards_alignment_enabled = $6,
            adaptive_paths_enabled = $7,
            srs_enabled = $8,
            diagnostic_assessments_enabled = $9,
            hint_scaffolding_enabled = $10,
            updated_at = NOW()
        WHERE course_code = $11
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
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            archived,
            notebook_enabled,
            feed_enabled,
            calendar_enabled,
            question_bank_enabled,
            lockdown_mode_enabled,
            standards_alignment_enabled,
            adaptive_paths_enabled,
            srs_enabled,
            diagnostic_assessments_enabled,
            hint_scaffolding_enabled,
            created_at,
            updated_at
        "#,
        schema::COURSES
    ))
    .bind(notebook_enabled)
    .bind(feed_enabled)
    .bind(calendar_enabled)
    .bind(question_bank_enabled)
    .bind(lockdown_mode_enabled)
    .bind(standards_alignment_enabled)
    .bind(adaptive_paths_enabled)
    .bind(srs_enabled)
    .bind(diagnostic_assessments_enabled)
    .bind(hint_scaffolding_enabled)
    .bind(course_code)
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
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            archived,
            notebook_enabled,
            feed_enabled,
            calendar_enabled,
            question_bank_enabled,
            lockdown_mode_enabled,
            standards_alignment_enabled,
            adaptive_paths_enabled,
            srs_enabled,
            diagnostic_assessments_enabled,
            hint_scaffolding_enabled,
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
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            archived,
            notebook_enabled,
            feed_enabled,
            calendar_enabled,
            question_bank_enabled,
            lockdown_mode_enabled,
            standards_alignment_enabled,
            adaptive_paths_enabled,
            srs_enabled,
            diagnostic_assessments_enabled,
            hint_scaffolding_enabled,
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

/// Distinct non-archived course IDs shown in the user's course catalog (matches [`list_for_enrolled_user`]).
pub async fn catalog_course_ids_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<HashSet<Uuid>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, Uuid>(&format!(
        r#"
        SELECT DISTINCT c.id
        FROM {} c
        INNER JOIN {} e ON e.course_id = c.id AND e.user_id = $1
        WHERE c.archived = false
        "#,
        schema::COURSES,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

/// Replace the user's catalog sort order. `ordered_course_ids` must be a permutation of
/// [`catalog_course_ids_for_user`].
pub async fn replace_user_course_catalog_order(
    pool: &PgPool,
    user_id: Uuid,
    ordered_course_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE user_id = $1"#,
        schema::USER_COURSE_CATALOG_ORDER
    ))
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    for (sort_order, course_id) in ordered_course_ids.iter().enumerate() {
        sqlx::query(&format!(
            r#"
            INSERT INTO {} (user_id, course_id, sort_order)
            VALUES ($1, $2, $3)
            "#,
            schema::USER_COURSE_CATALOG_ORDER
        ))
        .bind(user_id)
        .bind(course_id)
        .bind(sort_order as i32)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn set_course_archived(
    pool: &PgPool,
    course_code: &str,
    archived: bool,
) -> Result<Option<CoursePublic>, sqlx::Error> {
    sqlx::query_as::<_, CoursePublic>(&format!(
        r#"
        UPDATE {}
        SET
            archived = $1,
            updated_at = NOW()
        WHERE course_code = $2
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
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            archived,
            notebook_enabled,
            feed_enabled,
            calendar_enabled,
            question_bank_enabled,
            lockdown_mode_enabled,
            standards_alignment_enabled,
            adaptive_paths_enabled,
            srs_enabled,
            diagnostic_assessments_enabled,
            hint_scaffolding_enabled,
            created_at,
            updated_at
        "#,
        schema::COURSES
    ))
    .bind(archived)
    .bind(course_code)
    .fetch_optional(pool)
    .await
}

pub struct FactoryResetCourseOutcome {
    pub course: CoursePublic,
    pub removed_course_file_storage_keys: Vec<String>,
}

/// Removes all module items (including archived), syllabus, grading groups (replaced with one
/// default group), uploaded course files metadata, syllabus acceptances, and per-course activity
/// audit rows. Resets publish state, hero image, markdown theme, and grading scale. Keeps the
/// course row, enrollments, and permission grants.
pub async fn factory_reset_course(
    pool: &PgPool,
    course_code: &str,
) -> Result<Option<FactoryResetCourseOutcome>, sqlx::Error> {
    let Some(course_id) = get_id_by_course_code(pool, course_code).await? else {
        return Ok(None);
    };

    let mut tx = pool.begin().await?;

    // Must run before deleting structure items: `user_audit.structure_item_id` is ON DELETE SET
    // NULL, which would turn content_open/content_leave rows into NULL item ids and violate
    // `user_audit_structure_item_kind`.
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::USER_AUDIT
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1 AND parent_id IS NOT NULL"#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    crate::repos::question_bank::delete_question_bank_for_course(&mut tx, course_id).await?;

    let file_keys: Vec<String> = sqlx::query_scalar(&format!(
        r#"SELECT storage_key FROM {} WHERE course_id = $1"#,
        schema::COURSE_FILES
    ))
    .bind(course_id)
    .fetch_all(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::COURSE_FILES
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::SYLLABUS_ACCEPTANCES
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::COURSE_SYLLABUS
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::ASSIGNMENT_GROUPS
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, sort_order, name, weight_percent)
        VALUES ($1, 0, 'Assignments', 100.0)
        "#,
        schema::ASSIGNMENT_GROUPS
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    let row = sqlx::query_as::<_, CoursePublic>(&format!(
        r#"
        UPDATE {}
        SET
            published = false,
            archived = false,
            hero_image_url = NULL,
            hero_image_object_position = NULL,
            markdown_theme_preset = 'classic',
            markdown_theme_custom = NULL,
            grading_scale = 'letter_standard',
            notebook_enabled = true,
            feed_enabled = true,
            calendar_enabled = true,
            question_bank_enabled = false,
            lockdown_mode_enabled = false,
            standards_alignment_enabled = false,
            adaptive_paths_enabled = false,
            srs_enabled = false,
            diagnostic_assessments_enabled = false,
            hint_scaffolding_enabled = false,
            updated_at = NOW()
        WHERE course_code = $1
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
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
            published,
            markdown_theme_preset,
            markdown_theme_custom,
            grading_scale,
            archived,
            notebook_enabled,
            feed_enabled,
            calendar_enabled,
            question_bank_enabled,
            lockdown_mode_enabled,
            standards_alignment_enabled,
            adaptive_paths_enabled,
            srs_enabled,
            diagnostic_assessments_enabled,
            hint_scaffolding_enabled,
            created_at,
            updated_at
        "#,
        schema::COURSES
    ))
    .bind(course_code)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(course) = row else {
        tx.rollback().await?;
        return Ok(None);
    };

    tx.commit().await?;

    Ok(Some(FactoryResetCourseOutcome {
        course,
        removed_course_file_storage_keys: file_keys,
    }))
}
