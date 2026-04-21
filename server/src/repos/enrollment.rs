use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::db::schema;
use crate::models::enrollment::CourseEnrollmentPublic;
use crate::models::search::SearchPersonItem;
use crate::repos::course_grants;

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

/// Student enrollment row id for this course, if any.
pub async fn get_student_enrollment_id(
    pool: &PgPool,
    course_id: Uuid,
    user_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT id
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

/// Enrolled as course staff (`teacher` or `instructor`) for this course code.
pub async fn user_is_course_staff(
    pool: &PgPool,
    course_code: &str,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let roles = user_roles_in_course(pool, course_code, user_id).await?;
    Ok(roles.iter().any(|r| r == "teacher" || r == "instructor"))
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

async fn grant_course_enrollments_read_if_staff(
    pool: &PgPool,
    course_code: &str,
    course_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    let roles = user_roles_in_course(pool, course_code, user_id).await?;
    if roles.iter().any(|r| r == "teacher" || r == "instructor") {
        let perm = course_grants::course_enrollments_read_permission(course_code);
        course_grants::grant_course_permission_string(pool, user_id, course_id, &perm).await?;
    }
    Ok(())
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
        grant_course_enrollments_read_if_staff(pool, course_code, course_id, user_id).await?;
        return Ok(());
    }
    if roles.iter().any(|r| r == "instructor") {
        grant_course_enrollments_read_if_staff(pool, course_code, course_id, user_id).await?;
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
        grant_course_enrollments_read_if_staff(pool, course_code, course_id, user_id).await?;
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
    grant_course_enrollments_read_if_staff(pool, course_code, course_id, user_id).await?;
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

pub async fn user_has_access_by_course_id(
    pool: &PgPool,
    course_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {}
            WHERE course_id = $1 AND user_id = $2
        )
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(course_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

/// True when `staff_user_id` teaches or instructs a course where `student_user_id` is enrolled as a student.
pub async fn staff_sees_student_in_shared_course(
    pool: &PgPool,
    staff_user_id: Uuid,
    student_user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let ok: bool = sqlx::query_scalar(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM {0} ce_staff
            INNER JOIN {0} ce_stu ON ce_staff.course_id = ce_stu.course_id
            WHERE ce_staff.user_id = $1
              AND ce_staff.role IN ('teacher', 'instructor')
              AND ce_stu.user_id = $2
              AND ce_stu.role = 'student'
        )
        "#,
        schema::COURSE_ENROLLMENTS,
    ))
    .bind(staff_user_id)
    .bind(student_user_id)
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
            ce.role,
            (
                SELECT MAX(ua.occurred_at)
                FROM {} ua
                WHERE ua.user_id = ce.user_id AND ua.course_id = c.id
            ) AS last_course_access_at
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
        schema::USER_AUDIT,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES,
        schema::USERS
    ))
    .bind(course_code)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| r.into_public()).collect())
}

/// Learners with a `student` enrollment row, for gradebook views (`course:…:gradebook:view`).
/// One row per `user_id` (stable label for display). Ordered by display label.
pub async fn list_student_users_for_course_code(
    pool: &PgPool,
    course_code: &str,
) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as(&format!(
        r#"
        SELECT ce.user_id,
               COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) AS display_label
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        INNER JOIN {} u ON u.id = ce.user_id
        WHERE c.course_code = $1 AND ce.role = 'student'
        ORDER BY display_label ASC, ce.user_id ASC
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES,
        schema::USERS
    ))
    .bind(course_code)
    .fetch_all(pool)
    .await?;

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (user_id, label) in rows {
        if seen.insert(user_id) {
            out.push((user_id, label));
        }
    }
    Ok(out)
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
    last_course_access_at: Option<DateTime<Utc>>,
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
            last_course_access_at: self.last_course_access_at,
            group_memberships: Vec::new(),
        }
    }
}

/// Returns `true` if a new student row was inserted, `false` if the user was already enrolled.
#[derive(Debug, Clone)]
pub struct EnrollmentById {
    pub id: Uuid,
    pub course_id: Uuid,
    pub course_code: String,
    pub user_id: Uuid,
    pub role: String,
}

#[derive(sqlx::FromRow)]
struct EnrollmentByIdDb {
    id: Uuid,
    course_id: Uuid,
    course_code: String,
    user_id: Uuid,
    role: String,
}

impl From<EnrollmentByIdDb> for EnrollmentById {
    fn from(r: EnrollmentByIdDb) -> Self {
        EnrollmentById {
            id: r.id,
            course_id: r.course_id,
            course_code: r.course_code,
            user_id: r.user_id,
            role: r.role,
        }
    }
}

/// Resolve a roster row anywhere in the platform (used for accommodation summary authorization).
pub async fn get_enrollment_by_id(
    pool: &PgPool,
    enrollment_id: Uuid,
) -> Result<Option<EnrollmentById>, sqlx::Error> {
    sqlx::query_as::<_, EnrollmentByIdDb>(&format!(
        r#"
        SELECT ce.id, ce.course_id, c.course_code, ce.user_id, ce.role
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        WHERE ce.id = $1
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(enrollment_id)
    .fetch_optional(pool)
    .await
    .map(|o| o.map(Into::into))
}

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

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EnrollmentForPatch {
    pub id: Uuid,
    pub user_id: Uuid,
    pub course_id: Uuid,
    pub role: String,
}

pub async fn get_enrollment_for_patch(
    pool: &PgPool,
    course_code: &str,
    enrollment_id: Uuid,
) -> Result<Option<EnrollmentForPatch>, sqlx::Error> {
    sqlx::query_as::<_, EnrollmentForPatch>(&format!(
        r#"
        SELECT ce.id, ce.user_id, ce.course_id, ce.role
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        WHERE c.course_code = $1 AND ce.id = $2
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(course_code)
    .bind(enrollment_id)
    .fetch_optional(pool)
    .await
}

/// Sets this enrollment row to `student` when it was `instructor`, and clears `user_course_grants`
/// for that person in this course. Returns `false` when no matching row was updated.
pub async fn demote_instructor_enrollment_row(
    pool: &PgPool,
    course_code: &str,
    enrollment_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query_as::<_, (Uuid, Uuid)>(&format!(
        r#"
        UPDATE {} ce
        SET role = 'student'
        FROM {} c
        WHERE ce.id = $1 AND c.id = ce.course_id AND c.course_code = $2
          AND ce.role = 'instructor'
        RETURNING ce.user_id, ce.course_id
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES
    ))
    .bind(enrollment_id)
    .bind(course_code)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((user_id, course_id)) = row else {
        tx.rollback().await?;
        return Ok(false);
    };

    course_grants::clear_user_course_grants_for_course(&mut *tx, user_id, course_id).await?;
    tx.commit().await?;
    Ok(true)
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

/// `(email, role, display_name)` rows for JSON export (one row per enrollment, including multiple roles per user).
pub async fn list_email_roles_for_course_export(
    pool: &PgPool,
    course_code: &str,
) -> Result<Vec<(String, String, Option<String>)>, sqlx::Error> {
    sqlx::query_as::<_, (String, String, Option<String>)>(&format!(
        r#"
        SELECT
            u.email,
            ce.role,
            NULLIF(TRIM(u.display_name), '') AS display_name
        FROM {} ce
        INNER JOIN {} c ON c.id = ce.course_id
        INNER JOIN {} u ON u.id = ce.user_id
        WHERE c.course_code = $1
        ORDER BY lower(u.email) ASC, ce.role ASC
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::COURSES,
        schema::USERS
    ))
    .bind(course_code)
    .fetch_all(pool)
    .await
}

/// Removes every enrollment except the course creator’s `teacher` row (used when replacing the roster from an export).
pub async fn delete_enrollments_except_creator_teacher(
    pool: &PgPool,
    course_id: Uuid,
    creator_user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE course_id = $1
          AND NOT (user_id = $2 AND role = 'teacher')
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(course_id)
    .bind(creator_user_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Ensures the creator holds a `teacher` enrollment row (idempotent).
pub async fn ensure_teacher_enrollment(
    pool: &PgPool,
    course_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, user_id, role)
        VALUES ($1, $2, 'teacher')
        ON CONFLICT (course_id, user_id, role) DO NOTHING
        "#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(course_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}
