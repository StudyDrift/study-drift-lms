use std::collections::BTreeSet;

use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

use crate::db::schema;
use crate::repos::rbac;

/// Four-segment permission for creating course items in a single course (`course:<course_code>:item:create`).
pub fn course_item_create_permission(course_code: &str) -> String {
    format!("course:{course_code}:item:create")
}

/// Quiz question bank and related editor surfaces (`course:<course_code>:items:create`).
pub fn course_items_create_permission(course_code: &str) -> String {
    format!("course:{course_code}:items:create")
}

/// For every `course:…:item:create` in `out`, also insert `course:…:items:create` (quiz bank sibling).
pub fn add_items_create_sibling_grants(out: &mut BTreeSet<String>) {
    let sources: Vec<String> = out
        .iter()
        .filter(|p| p.starts_with("course:") && p.ends_with(":item:create"))
        .cloned()
        .collect();
    for p in sources {
        if let Some(prefix) = p.strip_suffix(":item:create") {
            out.insert(format!("{prefix}:items:create"));
        }
    }
}

/// `course:<course_code>:enrollments:read` — view roster rows for that course.
pub fn course_enrollments_read_permission(course_code: &str) -> String {
    format!("course:{course_code}:enrollments:read")
}

/// `course:<course_code>:enrollments:update` — add/remove enrollment rows for that course (e.g. drop a duplicate role).
pub fn course_enrollments_update_permission(course_code: &str) -> String {
    format!("course:{course_code}:enrollments:update")
}

/// `course:<course_code>:gradebook:view` — read course grading settings (scale and assignment groups).
pub fn course_gradebook_view_permission(course_code: &str) -> String {
    format!("course:{course_code}:gradebook:view")
}

/// Second segment value in catalog permissions meaning “this course” when the role is applied per course.
pub const COURSE_CODE_PLACEHOLDER: &str = "<courseCode>";

/// `true` when `s` is a four-part `course:` permission whose course segment is the placeholder token
/// (e.g. `course:<courseCode>:gradebook:view`).
pub fn is_course_permission_with_placeholder_token(s: &str) -> bool {
    let parts: Vec<&str> = s.trim().split(':').collect();
    parts.len() == 4 && parts[0] == "course" && parts[1] == COURSE_CODE_PLACEHOLDER
}

/// Builds a concrete `course:<course_code>:…` grant string when `granted` is a `course:` permission
/// for this course (`*`, `<courseCode>`, or matching code in the second segment). Non-course permissions return `None`.
pub fn expand_course_permission_for_course(granted: &str, course_code: &str) -> Option<String> {
    let parts: Vec<&str> = granted.trim().split(':').collect();
    if parts.len() != 4 || parts[0] != "course" {
        return None;
    }
    let area = parts[1];
    if area == "*" || area == course_code || area == COURSE_CODE_PLACEHOLDER {
        return Some(format!("course:{}:{}:{}", course_code, parts[2], parts[3]));
    }
    None
}

pub async fn grant_course_permission_string<'e, E>(
    executor: E,
    user_id: Uuid,
    course_id: Uuid,
    permission_string: &str,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, course_id, permission_string)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, course_id, permission_string) DO NOTHING
        "#,
        schema::USER_COURSE_GRANTS
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(permission_string)
    .execute(executor)
    .await?;
    Ok(())
}

/// Inserts `user_course_grants` for each course permission in `app_role`, scoped to `course_code`.
pub async fn apply_app_role_course_grants(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    course_code: &str,
    role_id: Uuid,
) -> Result<(), sqlx::Error> {
    let strings = rbac::list_permission_strings_for_role(pool, role_id).await?;
    for s in strings {
        if let Some(concrete) = expand_course_permission_for_course(&s, course_code) {
            grant_course_permission_string(pool, user_id, course_id, &concrete).await?;
        }
    }
    Ok(())
}

/// Removes rows in `user_course_grants` for this user and course whose permission belongs to this
/// course (`course:<this course's code>:…`), using `split_part` so course codes with `_` are safe.
pub async fn clear_user_course_grants_for_course<'e, E>(
    executor: E,
    user_id: Uuid,
    course_id: Uuid,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        DELETE FROM {ug} g
        USING {courses} c
        WHERE g.user_id = $1 AND g.course_id = $2 AND c.id = g.course_id
          AND split_part(g.permission_string, ':', 1) = 'course'
          AND split_part(g.permission_string, ':', 2) = c.course_code
        "#,
        ug = schema::USER_COURSE_GRANTS,
        courses = schema::COURSES,
    ))
    .bind(user_id)
    .bind(course_id)
    .execute(executor)
    .await?;
    Ok(())
}

/// Clears concrete `course:<code>:…` grants for this user, re-adds roster read for staff, then applies `app_role_id`.
pub async fn replace_course_app_role_grants_for_user(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    course_code: &str,
    app_role_id: Uuid,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    clear_user_course_grants_for_course(&mut *tx, user_id, course_id).await?;
    let enroll_read = course_enrollments_read_permission(course_code);
    grant_course_permission_string(&mut *tx, user_id, course_id, &enroll_read).await?;
    let strings = rbac::list_permission_strings_for_role(pool, app_role_id).await?;
    for s in strings {
        if let Some(concrete) = expand_course_permission_for_course(&s, course_code) {
            grant_course_permission_string(&mut *tx, user_id, course_id, &concrete).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_placeholder_to_concrete_course_code() {
        assert_eq!(
            expand_course_permission_for_course("course:<courseCode>:gradebook:view", "C-ABC123"),
            Some("course:C-ABC123:gradebook:view".to_string())
        );
    }

    #[test]
    fn expand_star_still_works() {
        assert_eq!(
            expand_course_permission_for_course("course:*:item:create", "C-XYZ"),
            Some("course:C-XYZ:item:create".to_string())
        );
    }

    #[test]
    fn detects_placeholder_token() {
        assert!(is_course_permission_with_placeholder_token(
            "course:<courseCode>:gradebook:view"
        ));
        assert!(!is_course_permission_with_placeholder_token(
            "course:C-1:gradebook:view"
        ));
    }

    #[test]
    fn course_item_create_permission_formats() {
        assert_eq!(
            course_item_create_permission("C-XYZ"),
            "course:C-XYZ:item:create"
        );
    }

    #[test]
    fn course_items_create_permission_formats() {
        assert_eq!(
            course_items_create_permission("C-XYZ"),
            "course:C-XYZ:items:create"
        );
    }

    #[test]
    fn add_items_create_sibling_grants_adds_quiz_pair() {
        let mut out = BTreeSet::from([
            "course:C-1:item:create".to_string(),
            "course:C-1:other:read".to_string(),
        ]);
        add_items_create_sibling_grants(&mut out);
        assert!(out.contains("course:C-1:items:create"));
        assert!(out.contains("course:C-1:item:create"));
    }

    #[test]
    fn course_enrollments_read_permission_formats() {
        assert_eq!(
            course_enrollments_read_permission("C-XYZ"),
            "course:C-XYZ:enrollments:read"
        );
    }

    #[test]
    fn course_enrollments_update_permission_formats() {
        assert_eq!(
            course_enrollments_update_permission("C-XYZ"),
            "course:C-XYZ:enrollments:update"
        );
    }

    #[test]
    fn course_gradebook_view_permission_formats() {
        assert_eq!(
            course_gradebook_view_permission("C-XYZ"),
            "course:C-XYZ:gradebook:view"
        );
    }
}
