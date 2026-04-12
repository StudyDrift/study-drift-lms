use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_grading::{
    AssignmentGroupInput, AssignmentGroupPublic, CourseGradingSettingsResponse,
};
use crate::repos::course;

#[derive(Debug, sqlx::FromRow)]
struct AssignmentGroupRow {
    id: Uuid,
    sort_order: i32,
    name: String,
    weight_percent: f64,
}

pub async fn get_settings_for_course_code(
    pool: &PgPool,
    course_code: &str,
) -> Result<Option<CourseGradingSettingsResponse>, sqlx::Error> {
    let row = sqlx::query_as::<_, (String,)>(&format!(
        r#"
        SELECT grading_scale
        FROM {}
        WHERE course_code = $1
        "#,
        schema::COURSES
    ))
    .bind(course_code)
    .fetch_optional(pool)
    .await?;

    let Some((grading_scale,)) = row else {
        return Ok(None);
    };

    let Some(course_id) = course::get_id_by_course_code(pool, course_code).await? else {
        return Ok(None);
    };

    let groups = list_assignment_groups(pool, course_id).await?;

    Ok(Some(CourseGradingSettingsResponse {
        grading_scale,
        assignment_groups: groups,
    }))
}

pub async fn list_assignment_groups(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<AssignmentGroupPublic>, sqlx::Error> {
    let rows = sqlx::query_as::<_, AssignmentGroupRow>(&format!(
        r#"
        SELECT id, sort_order, name, weight_percent
        FROM {}
        WHERE course_id = $1
        ORDER BY sort_order ASC, name ASC
        "#,
        schema::ASSIGNMENT_GROUPS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| AssignmentGroupPublic {
            id: r.id,
            sort_order: r.sort_order,
            name: r.name,
            weight_percent: r.weight_percent,
        })
        .collect())
}

/// Returns `Err(())` when an input references a group id that does not belong to this course.
pub async fn put_settings(
    pool: &PgPool,
    course_code: &str,
    grading_scale: &str,
    groups: &[AssignmentGroupInput],
) -> Result<Option<CourseGradingSettingsResponse>, PutError> {
    let Some(course_id) = course::get_id_by_course_code(pool, course_code)
        .await
        .map_err(PutError::Db)?
    else {
        return Ok(None);
    };

    let mut tx = pool.begin().await.map_err(PutError::Db)?;

    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET grading_scale = $1, updated_at = NOW()
        WHERE course_code = $2
        "#,
        schema::COURSES
    ))
    .bind(grading_scale)
    .bind(course_code)
    .execute(&mut *tx)
    .await
    .map_err(PutError::Db)?;

    let mut kept_ids: Vec<Uuid> = Vec::new();

    for g in groups {
        let name = g.name.trim();
        if name.is_empty() {
            continue;
        }
        let w = g.weight_percent.clamp(0.0, 100.0);

        if let Some(id) = g.id {
            let n = sqlx::query(&format!(
                r#"
                UPDATE {}
                SET sort_order = $2, name = $3, weight_percent = $4, updated_at = NOW()
                WHERE id = $1 AND course_id = $5
                "#,
                schema::ASSIGNMENT_GROUPS
            ))
            .bind(id)
            .bind(g.sort_order)
            .bind(name)
            .bind(w)
            .bind(course_id)
            .execute(&mut *tx)
            .await
            .map_err(PutError::Db)?
            .rows_affected();
            if n == 0 {
                return Err(PutError::UnknownGroupId(id));
            }
            kept_ids.push(id);
        } else {
            let new_id: Uuid = sqlx::query_scalar(&format!(
                r#"
                INSERT INTO {} (course_id, sort_order, name, weight_percent)
                VALUES ($1, $2, $3, $4)
                RETURNING id
                "#,
                schema::ASSIGNMENT_GROUPS
            ))
            .bind(course_id)
            .bind(g.sort_order)
            .bind(name)
            .bind(w)
            .fetch_one(&mut *tx)
            .await
            .map_err(PutError::Db)?;
            kept_ids.push(new_id);
        }
    }

    if !kept_ids.is_empty() {
        sqlx::query(&format!(
            r#"
            DELETE FROM {}
            WHERE course_id = $1 AND NOT (id = ANY($2::uuid[]))
            "#,
            schema::ASSIGNMENT_GROUPS
        ))
        .bind(course_id)
        .bind(&kept_ids)
        .execute(&mut *tx)
        .await
        .map_err(PutError::Db)?;
    } else {
        sqlx::query(&format!(
            r#"DELETE FROM {} WHERE course_id = $1"#,
            schema::ASSIGNMENT_GROUPS
        ))
        .bind(course_id)
        .execute(&mut *tx)
        .await
        .map_err(PutError::Db)?;
    }

    tx.commit().await.map_err(PutError::Db)?;

    get_settings_for_course_code(pool, course_code)
        .await
        .map_err(PutError::Db)
}

pub enum PutError {
    Db(sqlx::Error),
    UnknownGroupId(Uuid),
}

impl From<sqlx::Error> for PutError {
    fn from(e: sqlx::Error) -> Self {
        PutError::Db(e)
    }
}

pub async fn group_belongs_to_course(
    pool: &PgPool,
    course_id: Uuid,
    group_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {} WHERE id = $1 AND course_id = $2
        )
        "#,
        schema::ASSIGNMENT_GROUPS
    ))
    .bind(group_id)
    .bind(course_id)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

/// Inserts a group with a fixed id when it is missing for this course.
/// Deletes all assignment groups for the course, then inserts groups from an import/export bundle
/// using the bundle's fixed UUIDs (so module items can reference `assignment_group_id`).
pub async fn replace_assignment_groups_for_import(
    pool: &PgPool,
    course_code: &str,
    grading_scale: &str,
    groups: &[AssignmentGroupPublic],
) -> Result<(), sqlx::Error> {
    let Some(course_id) = course::get_id_by_course_code(pool, course_code).await? else {
        return Ok(());
    };

    let mut tx = pool.begin().await?;

    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET grading_scale = $1, updated_at = NOW()
        WHERE course_code = $2
        "#,
        schema::COURSES
    ))
    .bind(grading_scale)
    .bind(course_code)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::ASSIGNMENT_GROUPS
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    let mut sorted: Vec<&AssignmentGroupPublic> = groups.iter().collect();
    sorted.sort_by(|a, b| {
        a.sort_order
            .cmp(&b.sort_order)
            .then_with(|| a.name.cmp(&b.name))
    });

    for (i, g) in sorted.into_iter().enumerate() {
        let name = g.name.trim();
        if name.is_empty() {
            continue;
        }
        let w = g.weight_percent.clamp(0.0, 100.0);
        let sort_order = (i + 1) as i32;
        sqlx::query(&format!(
            r#"
            INSERT INTO {} (id, course_id, sort_order, name, weight_percent)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            schema::ASSIGNMENT_GROUPS
        ))
        .bind(g.id)
        .bind(course_id)
        .bind(sort_order)
        .bind(name)
        .bind(w)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn insert_assignment_group_if_missing(
    pool: &PgPool,
    course_id: Uuid,
    id: Uuid,
    sort_order: i32,
    name: &str,
    weight_percent: f64,
) -> Result<bool, sqlx::Error> {
    let inserted = sqlx::query_scalar::<_, Uuid>(&format!(
        r#"
        INSERT INTO {} (id, course_id, sort_order, name, weight_percent)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        "#,
        schema::ASSIGNMENT_GROUPS
    ))
    .bind(id)
    .bind(course_id)
    .bind(sort_order)
    .bind(name)
    .bind(weight_percent)
    .fetch_optional(pool)
    .await?;
    Ok(inserted.is_some())
}
