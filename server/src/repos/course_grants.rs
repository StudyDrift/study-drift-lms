use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

use crate::db::schema;
use crate::repos::rbac;

/// Four-segment permission for creating course items in a single course (`course:<course_code>:item:create`).
pub fn course_item_create_permission(course_code: &str) -> String {
    format!("course:{course_code}:item:create")
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
        return Some(format!(
            "course:{}:{}:{}",
            course_code, parts[2], parts[3]
        ));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_placeholder_to_concrete_course_code() {
        assert_eq!(
            expand_course_permission_for_course(
                "course:<courseCode>:gradebook:view",
                "C-ABC123"
            ),
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
}
