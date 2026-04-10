use std::collections::{BTreeSet, HashMap};

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::authz::any_grant_matches;
use crate::db::schema;
use crate::models::rbac::{AppRole, Permission, RoleWithPermissions, UserBrief};
use crate::repos::course_grants;
use crate::repos::enrollment;

#[derive(sqlx::FromRow)]
struct RolePermRow {
    role_id: Uuid,
    perm_id: Uuid,
    permission_string: String,
    description: String,
    created_at: DateTime<Utc>,
}

pub fn validate_permission_string(raw: &str) -> Result<(), String> {
    let s = raw.trim();
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 4 {
        return Err(
            "Permission must have exactly four segments: scope:area:function:action (wildcards use *)."
                .into(),
        );
    }
    for p in parts {
        if p.is_empty() {
            return Err("Each segment must be non-empty (use * for a wildcard).".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod validate_tests {
    use super::validate_permission_string;

    #[test]
    fn accepts_four_segments() {
        assert!(validate_permission_string("a:b:c:d").is_ok());
    }

    #[test]
    fn rejects_wrong_count() {
        assert!(validate_permission_string("a:b").is_err());
    }

    #[test]
    fn rejects_empty_segment() {
        assert!(validate_permission_string("a:b::d").is_err());
    }
}

pub async fn list_permissions(pool: &PgPool) -> Result<Vec<Permission>, sqlx::Error> {
    sqlx::query_as::<_, Permission>(&format!(
        r#"
        SELECT id, permission_string, description, created_at
        FROM {}
        ORDER BY permission_string ASC
        "#,
        schema::PERMISSIONS
    ))
    .fetch_all(pool)
    .await
}

pub async fn create_permission(
    pool: &PgPool,
    permission_string: &str,
    description: &str,
) -> Result<Permission, sqlx::Error> {
    sqlx::query_as::<_, Permission>(&format!(
        r#"
        INSERT INTO {} (permission_string, description)
        VALUES ($1, $2)
        RETURNING id, permission_string, description, created_at
        "#,
        schema::PERMISSIONS
    ))
    .bind(permission_string)
    .bind(description)
    .fetch_one(pool)
    .await
}

pub async fn patch_permission(
    pool: &PgPool,
    id: Uuid,
    description: &str,
) -> Result<Option<Permission>, sqlx::Error> {
    sqlx::query_as::<_, Permission>(&format!(
        r#"
        UPDATE {}
        SET description = $2
        WHERE id = $1
        RETURNING id, permission_string, description, created_at
        "#,
        schema::PERMISSIONS
    ))
    .bind(id)
    .bind(description)
    .fetch_optional(pool)
    .await
}

pub async fn delete_permission(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        "DELETE FROM {} WHERE id = $1",
        schema::PERMISSIONS
    ))
    .bind(id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

pub async fn list_roles(pool: &PgPool) -> Result<Vec<AppRole>, sqlx::Error> {
    sqlx::query_as::<_, AppRole>(&format!(
        r#"
        SELECT id, name, description, scope, created_at
        FROM {}
        ORDER BY name ASC
        "#,
        schema::APP_ROLES
    ))
    .fetch_all(pool)
    .await
}

pub async fn list_roles_with_permissions(
    pool: &PgPool,
) -> Result<Vec<RoleWithPermissions>, sqlx::Error> {
    let roles = list_roles(pool).await?;
    let rows = sqlx::query_as::<_, RolePermRow>(&format!(
        r#"
        SELECT rp.role_id, p.id AS perm_id, p.permission_string, p.description, p.created_at
        FROM {} rp
        INNER JOIN {} p ON p.id = rp.permission_id
        "#,
        schema::RBAC_ROLE_PERMISSIONS,
        schema::PERMISSIONS
    ))
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<Uuid, Vec<Permission>> = HashMap::new();
    for r in rows {
        map.entry(r.role_id).or_default().push(Permission {
            id: r.perm_id,
            permission_string: r.permission_string,
            description: r.description,
            created_at: r.created_at,
        });
    }
    for perms in map.values_mut() {
        perms.sort_by(|a, b| a.permission_string.cmp(&b.permission_string));
    }

    let mut out = Vec::with_capacity(roles.len());
    for role in roles {
        let permissions = map.remove(&role.id).unwrap_or_default();
        out.push(RoleWithPermissions { role, permissions });
    }
    Ok(out)
}

pub async fn create_role(
    pool: &PgPool,
    name: &str,
    description: &str,
    scope: &str,
) -> Result<AppRole, sqlx::Error> {
    sqlx::query_as::<_, AppRole>(&format!(
        r#"
        INSERT INTO {} (name, description, scope)
        VALUES ($1, $2, $3)
        RETURNING id, name, description, scope, created_at
        "#,
        schema::APP_ROLES
    ))
    .bind(name)
    .bind(description)
    .bind(scope)
    .fetch_one(pool)
    .await
}

pub async fn patch_role(
    pool: &PgPool,
    id: Uuid,
    name: &str,
    description: &str,
    scope: &str,
) -> Result<Option<AppRole>, sqlx::Error> {
    sqlx::query_as::<_, AppRole>(&format!(
        r#"
        UPDATE {}
        SET name = $2, description = $3, scope = $4
        WHERE id = $1
        RETURNING id, name, description, scope, created_at
        "#,
        schema::APP_ROLES
    ))
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(scope)
    .fetch_optional(pool)
    .await
}

pub async fn delete_role(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!("DELETE FROM {} WHERE id = $1", schema::APP_ROLES))
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

pub async fn set_role_permissions(
    pool: &PgPool,
    role_id: Uuid,
    permission_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    let mut uniq: Vec<Uuid> = permission_ids.to_vec();
    uniq.sort_unstable();
    uniq.dedup();

    let mut tx = pool.begin().await?;
    sqlx::query(&format!(
        "DELETE FROM {} WHERE role_id = $1",
        schema::RBAC_ROLE_PERMISSIONS
    ))
    .bind(role_id)
    .execute(&mut *tx)
    .await?;
    for pid in &uniq {
        sqlx::query(&format!(
            r#"
            INSERT INTO {} (role_id, permission_id)
            VALUES ($1, $2)
            "#,
            schema::RBAC_ROLE_PERMISSIONS
        ))
        .bind(role_id)
        .bind(pid)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

struct CourseViewFilter {
    course_code: String,
    view_as_student: bool,
}

/// Permission catalog strings for a named app role (e.g. `Teacher`, `Student`).
pub async fn list_permission_strings_for_role_name(
    pool: &PgPool,
    role_name: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT p.permission_string
        FROM {} r
        INNER JOIN {} rp ON rp.role_id = r.id
        INNER JOIN {} p ON p.id = rp.permission_id
        WHERE r.name = $1
        ORDER BY p.permission_string ASC
        "#,
        schema::APP_ROLES,
        schema::RBAC_ROLE_PERMISSIONS,
        schema::PERMISSIONS
    ))
    .bind(role_name)
    .fetch_all(pool)
    .await
}

fn filter_course_concrete_for_student_view(
    course_code: &str,
    grants: BTreeSet<String>,
    teacher_catalog: &[String],
    student_catalog: &[String],
) -> BTreeSet<String> {
    let prefix = format!("course:{}:", course_code);
    grants
        .into_iter()
        .filter(|p| {
            if !p.starts_with(&prefix) {
                return true;
            }
            let teacher_match = any_grant_matches(teacher_catalog, p);
            let student_match = any_grant_matches(student_catalog, p);
            if teacher_match && !student_match {
                return false;
            }
            true
        })
        .collect()
}

pub async fn list_granted_permission_strings(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    list_granted_permission_strings_inner(pool, user_id, None).await
}

/// Like [`list_granted_permission_strings`], but when `view_as_student` is true, course-scoped
/// permissions for `course_code` are reduced to those also granted to the Student role (or shared
/// with Student), and staff-only placeholder expansion for that course is skipped.
pub async fn list_granted_permission_strings_course_view(
    pool: &PgPool,
    user_id: Uuid,
    course_code: &str,
    view_as_student: bool,
) -> Result<Vec<String>, sqlx::Error> {
    list_granted_permission_strings_inner(
        pool,
        user_id,
        Some(CourseViewFilter {
            course_code: course_code.to_string(),
            view_as_student,
        }),
    )
    .await
}

async fn list_granted_permission_strings_inner(
    pool: &PgPool,
    user_id: Uuid,
    course_view: Option<CourseViewFilter>,
) -> Result<Vec<String>, sqlx::Error> {
    let raw: Vec<String> = sqlx::query_scalar(&format!(
        r#"
        SELECT s.permission_string FROM (
            SELECT DISTINCT p.permission_string
            FROM {} uar
            INNER JOIN {} rp ON rp.role_id = uar.role_id
            INNER JOIN {} p ON p.id = rp.permission_id
            WHERE uar.user_id = $1
            UNION
            SELECT DISTINCT g.permission_string
            FROM {} g
            WHERE g.user_id = $1
        ) AS s
        "#,
        schema::USER_APP_ROLES,
        schema::RBAC_ROLE_PERMISSIONS,
        schema::PERMISSIONS,
        schema::USER_COURSE_GRANTS,
    ))
    .bind(user_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut staff_course_codes =
        enrollment::list_course_codes_where_user_is_staff(pool, user_id).await?;
    if let Some(ref cv) = course_view {
        if cv.view_as_student {
            staff_course_codes.retain(|c| c != &cv.course_code);
        }
    }

    let mut out: BTreeSet<String> = BTreeSet::new();
    for s in raw {
        if course_grants::is_course_permission_with_placeholder_token(&s) {
            for cc in &staff_course_codes {
                if let Some(concrete) = course_grants::expand_course_permission_for_course(&s, cc) {
                    out.insert(concrete);
                }
            }
        } else {
            out.insert(s);
        }
    }

    let out = if let Some(ref cv) = course_view {
        if cv.view_as_student {
            let teacher = list_permission_strings_for_role_name(pool, "Teacher").await?;
            let student = list_permission_strings_for_role_name(pool, "Student").await?;
            filter_course_concrete_for_student_view(&cv.course_code, out, &teacher, &student)
        } else {
            out
        }
    } else {
        out
    };

    Ok(out.into_iter().collect())
}

pub async fn user_has_permission(
    pool: &PgPool,
    user_id: Uuid,
    required: &str,
) -> Result<bool, sqlx::Error> {
    let grants = list_granted_permission_strings(pool, user_id).await?;
    Ok(any_grant_matches(&grants, required))
}

pub async fn assign_user_role_by_name(
    pool: &PgPool,
    user_id: Uuid,
    role_name: &str,
) -> Result<(), sqlx::Error> {
    let role_id: Option<Uuid> = sqlx::query_scalar(&format!(
        "SELECT id FROM {} WHERE name = $1",
        schema::APP_ROLES
    ))
    .bind(role_name)
    .fetch_optional(pool)
    .await?;
    let Some(role_id) = role_id else {
        return Ok(());
    };
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        "#,
        schema::USER_APP_ROLES
    ))
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn role_exists(pool: &PgPool, role_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(&format!(
        "SELECT EXISTS(SELECT 1 FROM {} WHERE id = $1)",
        schema::APP_ROLES
    ))
    .bind(role_id)
    .fetch_one(pool)
    .await
}

pub async fn user_exists(pool: &PgPool, user_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(&format!(
        "SELECT EXISTS(SELECT 1 FROM {} WHERE id = $1)",
        schema::USERS
    ))
    .bind(user_id)
    .fetch_one(pool)
    .await
}

pub async fn list_users_in_role(
    pool: &PgPool,
    role_id: Uuid,
) -> Result<Vec<UserBrief>, sqlx::Error> {
    sqlx::query_as::<_, UserBrief>(&format!(
        r#"
        SELECT u.id, u.email, u.display_name
        FROM {} u
        INNER JOIN {} uar ON uar.user_id = u.id
        WHERE uar.role_id = $1
        ORDER BY LOWER(u.email) ASC
        "#,
        schema::USERS,
        schema::USER_APP_ROLES
    ))
    .bind(role_id)
    .fetch_all(pool)
    .await
}

pub async fn list_users_eligible_for_role(
    pool: &PgPool,
    role_id: Uuid,
    q: Option<&str>,
) -> Result<Vec<UserBrief>, sqlx::Error> {
    let pattern = match q.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => format!("%{s}%"),
        None => "%".to_string(),
    };

    sqlx::query_as::<_, UserBrief>(&format!(
        r#"
        SELECT u.id, u.email, u.display_name
        FROM {} u
        WHERE NOT EXISTS (
            SELECT 1 FROM {} uar
            WHERE uar.user_id = u.id AND uar.role_id = $1
        )
        AND (
            $2::text = '%'
            OR u.email ILIKE $2
            OR COALESCE(u.display_name, '') ILIKE $2
        )
        ORDER BY LOWER(u.email) ASC
        LIMIT 200
        "#,
        schema::USERS,
        schema::USER_APP_ROLES
    ))
    .bind(role_id)
    .bind(&pattern)
    .fetch_all(pool)
    .await
}

pub async fn add_user_to_role(
    pool: &PgPool,
    role_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        "#,
        schema::USER_APP_ROLES
    ))
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_user_from_role(
    pool: &PgPool,
    role_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        "DELETE FROM {} WHERE user_id = $1 AND role_id = $2",
        schema::USER_APP_ROLES
    ))
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

pub async fn get_role(pool: &PgPool, id: Uuid) -> Result<Option<AppRole>, sqlx::Error> {
    sqlx::query_as::<_, AppRole>(&format!(
        r#"
        SELECT id, name, description, scope, created_at
        FROM {}
        WHERE id = $1
        "#,
        schema::APP_ROLES
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn list_roles_by_scope(pool: &PgPool, scope: &str) -> Result<Vec<AppRole>, sqlx::Error> {
    sqlx::query_as::<_, AppRole>(&format!(
        r#"
        SELECT id, name, description, scope, created_at
        FROM {}
        WHERE scope = $1
        ORDER BY name ASC
        "#,
        schema::APP_ROLES
    ))
    .bind(scope)
    .fetch_all(pool)
    .await
}

pub async fn list_permission_strings_for_role(
    pool: &PgPool,
    role_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT p.permission_string
        FROM {} rp
        INNER JOIN {} p ON p.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY p.permission_string ASC
        "#,
        schema::RBAC_ROLE_PERMISSIONS,
        schema::PERMISSIONS
    ))
    .bind(role_id)
    .fetch_all(pool)
    .await
}
