use std::collections::HashMap;

use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

use crate::db::schema;
use crate::models::enrollment_group::{
    EnrollmentGroupMembershipPublic, EnrollmentGroupPublic, EnrollmentGroupSetPublic,
    EnrollmentGroupsTreeResponse,
};

pub async fn enrollment_groups_enabled_for_course(
    pool: &PgPool,
    course_code: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT c.enrollment_groups_enabled
        FROM {} c
        WHERE c.course_code = $1
        "#,
        schema::COURSES
    ))
    .bind(course_code)
    .fetch_optional(pool)
    .await
    .map(|o| o.unwrap_or(false))
}

async fn next_group_set_sort_order<'e, E>(e: E, course_id: Uuid) -> Result<i32, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let max: Option<i32> = sqlx::query_scalar(&format!(
        r#"
        SELECT MAX(sort_order) FROM {} WHERE course_id = $1
        "#,
        schema::ENROLLMENT_GROUP_SETS
    ))
    .bind(course_id)
    .fetch_one(e)
    .await?;
    Ok(max.unwrap_or(-1) + 1)
}

async fn next_group_sort_order<'e, E>(e: E, group_set_id: Uuid) -> Result<i32, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let max: Option<i32> = sqlx::query_scalar(&format!(
        r#"
        SELECT MAX(sort_order) FROM {} WHERE group_set_id = $1
        "#,
        schema::ENROLLMENT_GROUPS
    ))
    .bind(group_set_id)
    .fetch_one(e)
    .await?;
    Ok(max.unwrap_or(-1) + 1)
}

/// Enables the feature and ensures a default set + one empty group exist. Students start unassigned.
pub async fn enable_enrollment_groups(
    pool: &PgPool,
    course_id: Uuid,
    _course_code: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET enrollment_groups_enabled = true, updated_at = NOW()
        WHERE id = $1
        "#,
        schema::COURSES
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;

    let set_count: i64 = sqlx::query_scalar(&format!(
        r#"SELECT COUNT(*)::bigint FROM {} WHERE course_id = $1"#,
        schema::ENROLLMENT_GROUP_SETS
    ))
    .bind(course_id)
    .fetch_one(&mut *tx)
    .await?;

    if set_count == 0 {
        let sort_order = next_group_set_sort_order(&mut *tx, course_id).await?;
        let default_set_id: Uuid = sqlx::query_scalar(&format!(
            r#"
            INSERT INTO {} (course_id, name, sort_order)
            VALUES ($1, 'Default', $2)
            RETURNING id
            "#,
            schema::ENROLLMENT_GROUP_SETS
        ))
        .bind(course_id)
        .bind(sort_order)
        .fetch_one(&mut *tx)
        .await?;

        let g_order = next_group_sort_order(&mut *tx, default_set_id).await?;
        sqlx::query(&format!(
            r#"
            INSERT INTO {} (group_set_id, name, sort_order)
            VALUES ($1, 'Group 1', $2)
            "#,
            schema::ENROLLMENT_GROUPS
        ))
        .bind(default_set_id)
        .bind(g_order)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn list_memberships_for_course_code(
    pool: &PgPool,
    course_code: &str,
) -> Result<HashMap<Uuid, Vec<EnrollmentGroupMembershipPublic>>, sqlx::Error> {
    let rows: Vec<(Uuid, Uuid, Uuid)> = sqlx::query_as(&format!(
        r#"
        SELECT m.enrollment_id, m.group_set_id, m.group_id
        FROM {} m
        INNER JOIN {} ce ON ce.id = m.enrollment_id
        INNER JOIN {} c ON c.id = ce.course_id
        WHERE c.course_code = $1 AND ce.role = 'student'
        "#,
        schema::ENROLLMENT_GROUP_MEMBERSHIPS,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(course_code)
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<Uuid, Vec<EnrollmentGroupMembershipPublic>> = HashMap::new();
    for (enrollment_id, group_set_id, group_id) in rows {
        map.entry(enrollment_id)
            .or_default()
            .push(EnrollmentGroupMembershipPublic {
                group_set_id,
                group_id,
            });
    }
    Ok(map)
}

pub async fn tree_for_course_code(
    pool: &PgPool,
    course_code: &str,
) -> Result<EnrollmentGroupsTreeResponse, sqlx::Error> {
    let sets: Vec<(Uuid, String, i32)> = sqlx::query_as(&format!(
        r#"
        SELECT s.id, s.name, s.sort_order
        FROM {} s
        INNER JOIN {} c ON c.id = s.course_id
        WHERE c.course_code = $1
        ORDER BY s.sort_order ASC, s.created_at ASC
        "#,
        schema::ENROLLMENT_GROUP_SETS,
        schema::COURSES
    ))
    .bind(course_code)
    .fetch_all(pool)
    .await?;

    let mut group_sets = Vec::new();
    for (set_id, set_name, set_sort) in sets {
        let groups_rows: Vec<(Uuid, String, i32)> = sqlx::query_as(&format!(
            r#"
            SELECT g.id, g.name, g.sort_order
            FROM {} g
            WHERE g.group_set_id = $1
            ORDER BY g.sort_order ASC, g.created_at ASC
            "#,
            schema::ENROLLMENT_GROUPS
        ))
        .bind(set_id)
        .fetch_all(pool)
        .await?;

        let mut groups = Vec::new();
        for (gid, gname, gsort) in groups_rows {
            let enrollment_ids: Vec<Uuid> = sqlx::query_scalar(&format!(
                r#"
                SELECT m.enrollment_id
                FROM {} m
                INNER JOIN {} ce ON ce.id = m.enrollment_id
                WHERE m.group_id = $1 AND ce.role = 'student'
                ORDER BY m.created_at ASC
                "#,
                schema::ENROLLMENT_GROUP_MEMBERSHIPS,
                schema::COURSE_ENROLLMENTS
            ))
            .bind(gid)
            .fetch_all(pool)
            .await?;

            groups.push(EnrollmentGroupPublic {
                id: gid,
                name: gname,
                sort_order: gsort,
                enrollment_ids,
            });
        }

        group_sets.push(EnrollmentGroupSetPublic {
            id: set_id,
            name: set_name,
            sort_order: set_sort,
            groups,
        });
    }

    Ok(EnrollmentGroupsTreeResponse { group_sets })
}

pub async fn create_group_set(
    pool: &PgPool,
    course_id: Uuid,
    name: &str,
) -> Result<Uuid, sqlx::Error> {
    let sort_order = next_group_set_sort_order(pool, course_id).await?;
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (course_id, name, sort_order)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
        schema::ENROLLMENT_GROUP_SETS
    ))
    .bind(course_id)
    .bind(name)
    .bind(sort_order)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn create_group_in_set(
    pool: &PgPool,
    group_set_id: Uuid,
    name: &str,
) -> Result<Uuid, sqlx::Error> {
    let sort_order = next_group_sort_order(pool, group_set_id).await?;
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (group_set_id, name, sort_order)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
        schema::ENROLLMENT_GROUPS
    ))
    .bind(group_set_id)
    .bind(name)
    .bind(sort_order)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn group_set_belongs_to_course(
    pool: &PgPool,
    course_code: &str,
    set_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {} s
            INNER JOIN {} c ON c.id = s.course_id
            WHERE s.id = $1 AND c.course_code = $2
        )
        "#,
        schema::ENROLLMENT_GROUP_SETS,
        schema::COURSES
    ))
    .bind(set_id)
    .bind(course_code)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

pub async fn patch_group_set_name(
    pool: &PgPool,
    course_id: Uuid,
    set_id: Uuid,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        UPDATE {} s
        SET name = $1
        FROM {} c
        WHERE s.id = $2 AND s.course_id = c.id AND c.id = $3
        "#,
        schema::ENROLLMENT_GROUP_SETS,
        schema::COURSES
    ))
    .bind(name)
    .bind(set_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn patch_group_name(
    pool: &PgPool,
    course_id: Uuid,
    group_id: Uuid,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        UPDATE {} g
        SET name = $1
        FROM {} s
        INNER JOIN {} c ON c.id = s.course_id
        WHERE g.id = $2 AND g.group_set_id = s.id AND c.id = $3
        "#,
        schema::ENROLLMENT_GROUPS,
        schema::ENROLLMENT_GROUP_SETS,
        schema::COURSES
    ))
    .bind(name)
    .bind(group_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_group_set(
    pool: &PgPool,
    course_id: Uuid,
    set_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        DELETE FROM {} s
        USING {} c
        WHERE s.id = $1 AND s.course_id = c.id AND c.id = $2
        "#,
        schema::ENROLLMENT_GROUP_SETS,
        schema::COURSES
    ))
    .bind(set_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_group(
    pool: &PgPool,
    course_id: Uuid,
    group_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        DELETE FROM {} g
        USING {} s
        INNER JOIN {} c ON c.id = s.course_id
        WHERE g.id = $1 AND g.group_set_id = s.id AND c.id = $2
        "#,
        schema::ENROLLMENT_GROUPS,
        schema::ENROLLMENT_GROUP_SETS,
        schema::COURSES
    ))
    .bind(group_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

/// `true` when this enrollment row exists in the course and is a `student` role.
pub async fn enrollment_is_assignable_student(
    pool: &PgPool,
    course_code: &str,
    enrollment_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {} ce
            INNER JOIN {} c ON c.id = ce.course_id
            WHERE ce.id = $1 AND c.course_code = $2 AND ce.role = 'student'
        )
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(enrollment_id)
    .bind(course_code)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

/// Returns `false` when the enrollment or group does not belong to the course, group/set mismatch,
/// or the enrollment is not a student row (only students may be in groups).
pub async fn set_membership(
    pool: &PgPool,
    course_code: &str,
    enrollment_id: Uuid,
    group_set_id: Uuid,
    group_id: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let student_ok: bool = sqlx::query_scalar(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {} ce
            INNER JOIN {} c ON c.id = ce.course_id
            WHERE ce.id = $1 AND c.course_code = $2 AND ce.role = 'student'
        )
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(enrollment_id)
    .bind(course_code)
    .fetch_one(&mut *tx)
    .await?;

    if !student_ok {
        return Ok(false);
    }

    if let Some(gid) = group_id {
        let ok: bool = sqlx::query_scalar(&format!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM {} g
                INNER JOIN {} s ON s.id = g.group_set_id
                INNER JOIN {} c ON c.id = s.course_id
                WHERE g.id = $1 AND s.id = $2 AND c.course_code = $3
            )
            "#,
            schema::ENROLLMENT_GROUPS,
            schema::ENROLLMENT_GROUP_SETS,
            schema::COURSES
        ))
        .bind(gid)
        .bind(group_set_id)
        .bind(course_code)
        .fetch_one(&mut *tx)
        .await?;

        if !ok {
            return Ok(false);
        }

        sqlx::query(&format!(
            r#"
            INSERT INTO {} (enrollment_id, group_set_id, group_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (enrollment_id, group_set_id) DO UPDATE
            SET group_id = EXCLUDED.group_id
            "#,
            schema::ENROLLMENT_GROUP_MEMBERSHIPS
        ))
        .bind(enrollment_id)
        .bind(group_set_id)
        .bind(gid)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(&format!(
            r#"
            DELETE FROM {} m
            USING {} ce, {} c
            WHERE m.enrollment_id = ce.id
              AND ce.course_id = c.id
              AND c.course_code = $1
              AND m.enrollment_id = $2
              AND m.group_set_id = $3
            "#,
            schema::ENROLLMENT_GROUP_MEMBERSHIPS,
            schema::COURSE_ENROLLMENTS,
            schema::COURSES
        ))
        .bind(course_code)
        .bind(enrollment_id)
        .bind(group_set_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(true)
}
