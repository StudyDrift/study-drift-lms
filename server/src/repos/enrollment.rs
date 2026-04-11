use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::db::schema;
use crate::models::enrollment::CourseEnrollmentPublic;
use crate::models::search::SearchPersonItem;

/// Whether this user created the course (`courses.created_by_user_id`).
pub async fn user_is_course_creator(
    pool: &PgPool,
    course_code: &str,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {} c
            WHERE c.course_code = $1 AND c.created_by_user_id = $2
        )
        "#,
        schema::COURSES
    ))
    .bind(course_code)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

/// All enrollment roles for this user in the course (e.g. `teacher` and `student`).
/// `course_id` → `(role, enrollment created_at)` for this user.
pub async fn enrollment_course_meta(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<HashMap<Uuid, (String, DateTime<Utc>)>, sqlx::Error> {
    let rows: Vec<(Uuid, String, DateTime<Utc>)> = sqlx::query_as(&format!(
        r#"
        SELECT course_id, role, created_at
        FROM {}
        WHERE user_id = $1
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(a, b, c)| (a, (b, c))).collect())
}

pub async fn student_enrollment_started_at(
    pool: &PgPool,
    course_id: Uuid,
    user_id: Uuid,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT created_at
        FROM {}
        WHERE course_id = $1 AND user_id = $2 AND role = 'student'
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(course_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn user_roles_in_course(
    pool: &PgPool,
    course_code: &str,
    user_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(&format!(
        r#"
        SELECT ce.role
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        WHERE c.course_code = $1 AND ce.user_id = $2
        ORDER BY
            CASE ce.role
                WHEN 'teacher' THEN 0
                WHEN 'instructor' THEN 1
                ELSE 2
            END,
            ce.role ASC
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(course_code)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn user_has_enrollment_role(
    pool: &PgPool,
    course_code: &str,
    user_id: Uuid,
    role: &str,
) -> Result<bool, sqlx::Error> {
    let ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {} ce
            INNER JOIN {} c ON c.id = ce.course_id
            WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.role = $3
        )
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(course_code)
    .bind(user_id)
    .bind(role)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

/// Enrolls a user as `instructor` if missing; if already enrolled, upgrades non-`teacher` to instructor.
/// Does not change the course creator row (`teacher`).
pub async fn upsert_instructor_enrollment(
    pool: &PgPool,
    course_code: &str,
    course_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    let roles = user_roles_in_course(pool, course_code, user_id).await?;
    if roles.iter().any(|r| r == "teacher") {
        return Ok(());
    }
    if roles.iter().any(|r| r == "instructor") {
        return Ok(());
    }
    if roles.iter().any(|r| r == "student") {
        sqlx::query(&format!(
            r#"
            UPDATE {}
            SET role = 'instructor'
            WHERE course_id = $1 AND user_id = $2 AND role = 'student'
            "#,
            schema::COURSE_ENROLLMENTS
        ))
        .bind(course_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        return Ok(());
    }
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, user_id, role)
        VALUES ($1, $2, 'instructor')
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(course_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn user_has_access(
    pool: &PgPool,
    course_code: &str,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {} ce
            INNER JOIN {} c ON c.id = ce.course_id
            WHERE c.course_code = $1 AND ce.user_id = $2
        )
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(course_code)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

/// Course codes where the user is enrolled as course staff (`teacher` or `instructor`).
/// Used to expand `course:<courseCode>:…` catalog permissions into concrete per-course strings.
pub async fn list_course_codes_where_user_is_staff(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT c.course_code
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        WHERE ce.user_id = $1 AND ce.role IN ('teacher', 'instructor')
        ORDER BY c.course_code ASC
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn list_for_course_code(
    pool: &PgPool,
    course_code: &str,
) -> Result<Vec<CourseEnrollmentPublic>, sqlx::Error> {
    let rows = sqlx::query_as::<_, CourseEnrollmentRow>(&format!(
        r#"
        SELECT
            ce.id,
            ce.user_id,
            u.display_name,
            ce.role
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        INNER JOIN {} u ON u.id = ce.user_id
        WHERE c.course_code = $1
        ORDER BY
            CASE ce.role
                WHEN 'teacher' THEN 0
                WHEN 'instructor' THEN 1
                ELSE 2
            END,
            COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) ASC
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES,
        schema::USERS
    ))
    .bind(course_code)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| r.into_public()).collect())
}

/// All enrollments in courses the requester is enrolled in (same visibility as enrollments API).
/// Rows are capped for large rosters.
pub async fn list_people_for_enrolled_courses(
    pool: &PgPool,
    requester_user_id: Uuid,
) -> Result<Vec<SearchPersonItem>, sqlx::Error> {
    let rows = sqlx::query_as::<_, SearchPersonRow>(&format!(
        r#"
        SELECT
            u.id AS user_id,
            u.email,
            u.display_name,
            ce.role,
            c.course_code,
            c.title AS course_title
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        INNER JOIN {} u ON u.id = ce.user_id
        WHERE c.archived = false
          AND c.id IN (
            SELECT ce2.course_id
            FROM {} ce2
            WHERE ce2.user_id = $1
        )
        ORDER BY
            c.title ASC,
            CASE ce.role
                WHEN 'teacher' THEN 0
                WHEN 'instructor' THEN 1
                ELSE 2
            END,
            COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) ASC
        LIMIT 2000
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES,
        schema::USERS,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(requester_user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| r.into_public()).collect())
}

#[derive(Debug, sqlx::FromRow)]
struct SearchPersonRow {
    user_id: Uuid,
    email: String,
    display_name: Option<String>,
    role: String,
    course_code: String,
    course_title: String,
}

impl SearchPersonRow {
    fn into_public(self) -> SearchPersonItem {
        let role_display = match self.role.as_str() {
            "teacher" => "Teacher",
            "instructor" => "Instructor",
            "student" => "Student",
            _ => "Student",
        };
        SearchPersonItem {
            user_id: self.user_id,
            email: self.email,
            display_name: self.display_name,
            role: role_display.to_string(),
            course_code: self.course_code,
            course_title: self.course_title,
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct CourseEnrollmentRow {
    id: Uuid,
    user_id: Uuid,
    display_name: Option<String>,
    role: String,
}

impl CourseEnrollmentRow {
    fn into_public(self) -> CourseEnrollmentPublic {
        let role_display = match self.role.as_str() {
            "teacher" => "Teacher",
            "instructor" => "Instructor",
            "student" => "Student",
            _ => "Student",
        };
        CourseEnrollmentPublic {
            id: self.id,
            user_id: self.user_id,
            display_name: self.display_name,
            role: role_display.to_string(),
        }
    }
}

/// Returns `true` if a new student row was inserted, `false` if the user was already enrolled.
pub async fn insert_student_if_missing(
    pool: &PgPool,
    course_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let id = sqlx::query_scalar::<_, Uuid>(&format!(
        r#"
        INSERT INTO {} (course_id, user_id, role)
        VALUES ($1, $2, 'student')
        ON CONFLICT (course_id, user_id, role) DO NOTHING
        RETURNING id
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(course_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(id.is_some())
}

/// Enrolls the course creator with role `teacher` (RBAC `Teacher` supplies permissions).
/// Same ordering as list ordering: teacher > instructor > student.
pub fn enrollment_role_rank(role: &str) -> i32 {
    match role {
        "teacher" => 0,
        "instructor" => 1,
        "student" => 2,
        _ => 3,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnrollmentDeleteOutcome {
    Deleted,
    NotFound,
    /// This row is the enrollee's highest-ranked role while they have multiple enrollments in the course.
    CannotRemoveHighestRole,
}

/// Deletes one enrollment row. When the person has several roles, the highest-ranked row cannot be removed.
pub async fn delete_enrollment_for_course(
    pool: &PgPool,
    course_code: &str,
    enrollment_id: Uuid,
) -> Result<EnrollmentDeleteOutcome, sqlx::Error> {
    let row = sqlx::query_as::<_, EnrollmentForDelete>(&format!(
        r#"
        SELECT ce.user_id, ce.role, ce.course_id
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        WHERE ce.id = $1 AND c.course_code = $2
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(enrollment_id)
    .bind(course_code)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(EnrollmentDeleteOutcome::NotFound);
    };

    let roles = sqlx::query_scalar::<_, String>(&format!(
        r#"
        SELECT ce.role
        FROM {} ce
        WHERE ce.course_id = $1 AND ce.user_id = $2
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(row.course_id)
    .bind(row.user_id)
    .fetch_all(pool)
    .await?;

    if roles.len() > 1 {
        let min_rank = roles
            .iter()
            .map(|r| enrollment_role_rank(r.as_str()))
            .min()
            .unwrap_or(0);
        if enrollment_role_rank(row.role.as_str()) == min_rank {
            return Ok(EnrollmentDeleteOutcome::CannotRemoveHighestRole);
        }
    }

    let res = sqlx::query(&format!(
        "DELETE FROM {} WHERE id = $1",
        schema::COURSE_ENROLLMENTS
    ))
    .bind(enrollment_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(EnrollmentDeleteOutcome::NotFound);
    }
    Ok(EnrollmentDeleteOutcome::Deleted)
}

#[derive(Debug, sqlx::FromRow)]
struct EnrollmentForDelete {
    user_id: Uuid,
    role: String,
    course_id: Uuid,
}

pub async fn insert_course_creator_teacher(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    course_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, user_id, role)
        VALUES ($1, $2, 'teacher')
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(course_id)
    .bind(user_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}
