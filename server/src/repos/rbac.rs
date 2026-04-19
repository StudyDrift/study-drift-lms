use std::collections::{BTreeSet, HashMap};

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::authz::{any_grant_matches, permission_matches};
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

/// Treat `course:…:item:create` and `course:…:items:create` as equivalent when comparing to a role
/// catalog (so view-as-student hides both when only teachers hold `item:create`).
fn course_item_pair_matches_catalog(catalog: &[String], p: &str) -> bool {
    if any_grant_matches(catalog, p) {
        return true;
    }
    if let Some(prefix) = p.strip_suffix(":items:create") {
        if prefix.starts_with("course:") {
            let alt = format!("{prefix}:item:create");
            if any_grant_matches(catalog, &alt) {
                return true;
            }
        }
    }
    if let Some(prefix) = p.strip_suffix(":item:create") {
        if prefix.starts_with("course:") {
            let alt = format!("{prefix}:items:create");
            if any_grant_matches(catalog, &alt) {
                return true;
            }
        }
    }
    false
}

/// Whether `catalog` (role permission strings, possibly `course:<courseCode>:…` or `course:*:…`)
/// authorizes concrete permission `p` for `course_code`.
fn course_role_catalog_matches_concrete(catalog: &[String], p: &str, course_code: &str) -> bool {
    if course_item_pair_matches_catalog(catalog, p) {
        return true;
    }
    for entry in catalog {
        if let Some(expanded) =
            course_grants::expand_course_permission_for_course(entry, course_code)
        {
            if permission_matches(&expanded, p) {
                return true;
            }
        }
    }
    false
}

/// While viewing a course as a non-staff enrollee (or explicit “view as student”), drop
/// staff-only grants for **this** `course_code`, and drop **global** grants the Student app role
/// does not carry (so Teacher-only globals like reports do not leak during student context).
fn filter_grants_for_student_course_view(
    course_code: &str,
    grants: BTreeSet<String>,
    teacher_catalog: &[String],
    student_catalog: &[String],
) -> BTreeSet<String> {
    grants
        .into_iter()
        .filter(|p| {
            let parts: Vec<&str> = p.trim().split(':').collect();
            if parts.len() == 4 && parts[0] == "course" {
                if parts[1] == course_code {
                    let teacher_match =
                        course_role_catalog_matches_concrete(teacher_catalog, p, course_code);
                    let student_match =
                        course_role_catalog_matches_concrete(student_catalog, p, course_code);
                    return !(teacher_match && !student_match);
                }
                // Different course — keep (may be staff or student elsewhere).
                return true;
            }
            any_grant_matches(student_catalog, p)
        })
        .collect()
}

pub async fn list_granted_permission_strings(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    list_granted_permission_strings_inner(pool, user_id, None).await
}

/// Like [`list_granted_permission_strings`], but when `view_as_student` is true, effective grants
/// for this `course_code` follow the student experience: staff-only **course** grants for this
/// code are removed, **global** grants not present on the Student app role are removed, and
/// staff-only placeholder expansion for this course is skipped.
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

    course_grants::add_items_create_sibling_grants(&mut out);

    let out = if let Some(ref cv) = course_view {
        if cv.view_as_student {
            let teacher = list_permission_strings_for_role_name(pool, "Teacher").await?;
            let student = list_permission_strings_for_role_name(pool, "Student").await?;
            filter_grants_for_student_course_view(&cv.course_code, out, &teacher, &student)
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

pub async fn app_role_id_by_name(pool: &PgPool, role_name: &str) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        "SELECT id FROM {} WHERE name = $1",
        schema::APP_ROLES
    ))
    .bind(role_name)
    .fetch_optional(pool)
    .await
}

pub async fn assign_user_role_by_name(
    pool: &PgPool,
    user_id: Uuid,
    role_name: &str,
) -> Result<(), sqlx::Error> {
    let role_id: Option<Uuid> = app_role_id_by_name(pool, role_name).await?;
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

pub async fn get_user_brief(pool: &PgPool, user_id: Uuid) -> Result<Option<UserBrief>, sqlx::Error> {
    sqlx::query_as::<_, UserBrief>(&format!(
        r#"SELECT id, email, display_name, sid FROM {} WHERE id = $1"#,
        schema::USERS
    ))
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_users_in_role(
    pool: &PgPool,
    role_id: Uuid,
) -> Result<Vec<UserBrief>, sqlx::Error> {
    sqlx::query_as::<_, UserBrief>(&format!(
        r#"
        SELECT u.id, u.email, u.display_name, u.sid
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
        SELECT u.id, u.email, u.display_name, u.sid
        FROM {} u
        WHERE NOT EXISTS (
            SELECT 1 FROM {} uar
            WHERE uar.user_id = u.id AND uar.role_id = $1
        )
        AND (
            $2::text = '%'
            OR u.email ILIKE $2
            OR COALESCE(u.display_name, '') ILIKE $2
            OR COALESCE(u.sid, '') ILIKE $2
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

#[cfg(test)]
mod course_role_catalog_match_tests {
    use super::course_role_catalog_matches_concrete;

    #[test]
    fn placeholder_catalog_matches_concrete_enrollments_read() {
        let catalog = vec!["course:<courseCode>:enrollments:read".to_string()];
        assert!(course_role_catalog_matches_concrete(
            &catalog,
            "course:C-1:enrollments:read",
            "C-1"
        ));
    }

    #[test]
    fn star_area_catalog_matches_concrete() {
        let catalog = vec!["course:*:enrollments:read".to_string()];
        assert!(course_role_catalog_matches_concrete(
            &catalog,
            "course:C-1:enrollments:read",
            "C-1"
        ));
    }

    #[test]
    fn unrelated_catalog_does_not_match() {
        let catalog = vec!["global:app:course:create".to_string()];
        assert!(!course_role_catalog_matches_concrete(
            &catalog,
            "course:C-1:enrollments:read",
            "C-1"
        ));
    }
}

#[cfg(test)]
mod filter_grants_for_student_course_view_tests {
    use std::collections::BTreeSet;

    use super::filter_grants_for_student_course_view;

    #[test]
    fn removes_staff_only_grants_for_this_course() {
        let grants = BTreeSet::from([
            "course:C-1:enrollments:read".to_string(),
            "course:C-1:modules:read".to_string(),
        ]);
        let teacher = vec!["course:<courseCode>:enrollments:read".to_string()];
        let student = vec!["course:<courseCode>:modules:read".to_string()];
        let out = filter_grants_for_student_course_view("C-1", grants, &teacher, &student);
        assert!(!out.contains("course:C-1:enrollments:read"));
        assert!(out.contains("course:C-1:modules:read"));
    }

    #[test]
    fn removes_global_not_granted_to_student_role() {
        let grants = BTreeSet::from([
            "global:app:reports:view".to_string(),
            "global:app:course:create".to_string(),
        ]);
        let out = filter_grants_for_student_course_view("C-1", grants, &[], &[]);
        assert!(out.is_empty());
    }

    #[test]
    fn keeps_other_course_grants() {
        let grants = BTreeSet::from(["course:C-2:enrollments:read".to_string()]);
        let teacher = vec!["course:<courseCode>:enrollments:read".to_string()];
        let student: Vec<String> = vec![];
        let out = filter_grants_for_student_course_view("C-1", grants, &teacher, &student);
        assert!(out.contains("course:C-2:enrollments:read"));
    }

    #[test]
    fn keeps_global_on_student_catalog() {
        let grants = BTreeSet::from(["global:app:custom:thing".to_string()]);
        let student = vec!["global:app:custom:thing".to_string()];
        let out = filter_grants_for_student_course_view("C-1", grants, &[], &student);
        assert!(out.contains("global:app:custom:thing"));
    }
}
