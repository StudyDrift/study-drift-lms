//! Bulk enrollment and email parsing for course staff flows.

use std::collections::HashSet;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::enrollment::{AddEnrollmentsRequest, AddEnrollmentsResponse};
use crate::repos::course_grants;
use crate::repos::enrollment;
use crate::repos::rbac;
use crate::repos::user;
use crate::services::auth;

pub fn parse_email_list(raw: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for part in raw.split(|c: char| matches!(c, ',' | ';' | '\n' | '\r') || c.is_whitespace()) {
        let e = auth::normalize_email(part);
        if e.is_empty() || !e.contains('@') {
            continue;
        }
        if seen.insert(e.clone()) {
            out.push(e);
        }
    }
    out
}

pub async fn add_enrollments(
    pool: &PgPool,
    course_code: &str,
    course_id: Uuid,
    actor_user_id: Uuid,
    req: &AddEnrollmentsRequest,
) -> Result<AddEnrollmentsResponse, AppError> {
    let parsed = parse_email_list(&req.emails);
    if parsed.is_empty() {
        return Err(AppError::invalid_input(
            "Enter at least one valid email address.",
        ));
    }

    let is_creator = enrollment::user_is_course_creator(pool, course_code, actor_user_id).await?;

    if req.app_role_id.is_some() && !is_creator {
        return Err(AppError::Forbidden);
    }
    if is_creator && req.app_role_id.is_none() {
        return Err(AppError::invalid_input(
            "Select a course-scoped role for these enrollments.",
        ));
    }

    let mut added = Vec::new();
    let mut already_enrolled = Vec::new();
    let mut not_found = Vec::new();

    if let Some(role_id) = req.app_role_id {
        let Some(role_row) = rbac::get_role(pool, role_id).await? else {
            return Err(AppError::invalid_input("Unknown role."));
        };
        if role_row.scope != "course" {
            return Err(AppError::invalid_input(
                "Only course-scoped roles can be used when enrolling with a role.",
            ));
        }

        for email in parsed {
            let Some(row) = user::find_by_email(pool, &email).await? else {
                not_found.push(email);
                continue;
            };
            if enrollment::user_is_course_creator(pool, course_code, row.id).await? {
                already_enrolled.push(row.email);
                continue;
            }
            let existed_before = !enrollment::user_roles_in_course(pool, course_code, row.id)
                .await?
                .is_empty();

            enrollment::upsert_instructor_enrollment(pool, course_code, course_id, row.id).await?;
            course_grants::apply_app_role_course_grants(
                pool,
                row.id,
                course_id,
                course_code,
                role_id,
            )
            .await?;

            if existed_before {
                already_enrolled.push(row.email);
            } else {
                added.push(row.email);
            }
        }
    } else {
        for email in parsed {
            let Some(row) = user::find_by_email(pool, &email).await? else {
                not_found.push(email);
                continue;
            };
            let inserted = enrollment::insert_student_if_missing(pool, course_id, row.id).await?;
            if inserted {
                added.push(row.email);
            } else {
                already_enrolled.push(row.email);
            }
        }
    }

    Ok(AddEnrollmentsResponse {
        added,
        already_enrolled,
        not_found,
    })
}
