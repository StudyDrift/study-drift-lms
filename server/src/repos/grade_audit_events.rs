//! Append-only grade audit (`course.grade_audit_events`, plan 3.10).

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

/// Deterministic per grade cell (one row in `course_grades`); matches on every new audit insert.
pub fn grade_cell_id(course_id: Uuid, assignment_id: Uuid, student_id: Uuid) -> Uuid {
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("{course_id}#{assignment_id}#{student_id}").as_bytes(),
    )
}

fn dec_opt(f: f64) -> Option<Decimal> {
    if !f.is_finite() {
        return None;
    }
    use std::str::FromStr;
    // Avoid float→decimal drift: roundtrip through a fixed string.
    Decimal::from_str(&format!("{:.4}", f)).ok()
}

/// Insert a grade audit event (append-only). Use within the same transaction as the grade change.
pub async fn insert(
    ex: &mut sqlx::PgConnection,
    course_id: Uuid,
    assignment_id: Uuid,
    student_id: Uuid,
    changed_by: Option<Uuid>,
    action: &str,
    previous_score: Option<f64>,
    new_score: Option<f64>,
    previous_status: Option<&str>,
    new_status: Option<&str>,
    reason: Option<&str>,
) -> Result<(), sqlx::Error> {
    let grade_id = grade_cell_id(course_id, assignment_id, student_id);
    let prev = previous_score.and_then(dec_opt);
    let new_ = new_score.and_then(dec_opt);
    let changed_at = Utc::now();
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            grade_id, course_id, assignment_id, student_id, changed_by_user_id, action,
            previous_score, new_score, previous_status, new_status, reason, changed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#,
        schema::GRADE_AUDIT_EVENTS
    ))
    .bind(grade_id)
    .bind(course_id)
    .bind(assignment_id)
    .bind(student_id)
    .bind(changed_by)
    .bind(action)
    .bind(prev)
    .bind(new_)
    .bind(previous_status)
    .bind(new_status)
    .bind(reason)
    .bind(changed_at)
    .execute(ex)
    .await?;
    tracing::info!(
        target: "grade_audit",
        %course_id,
        %assignment_id,
        %student_id,
        action = %action,
        "grade_audit_event_written"
    );
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeAuditEventRow {
    pub id: Uuid,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_score: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_score: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub changed_at: DateTime<Utc>,
    /// Omitted in student view when the grade is still unposted to students.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<Uuid>,
}

pub async fn list_for_cell(
    pool: &PgPool,
    course_id: Uuid,
    assignment_id: Uuid,
    student_id: Uuid,
) -> Result<Vec<GradeAuditEventRow>, sqlx::Error> {
    let rows: Vec<(
        Uuid,
        String,
        Option<Decimal>,
        Option<Decimal>,
        Option<String>,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
        Option<Uuid>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT
            id, action, previous_score, new_score, previous_status, new_status, reason, changed_at,
            changed_by_user_id
        FROM {}
        WHERE course_id = $1 AND assignment_id = $2 AND student_id = $3
        ORDER BY changed_at ASC, id ASC
        "#,
        schema::GRADE_AUDIT_EVENTS
    ))
    .bind(course_id)
    .bind(assignment_id)
    .bind(student_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                action,
                previous_score,
                new_score,
                previous_status,
                new_status,
                reason,
                changed_at,
                changed_by,
            )| GradeAuditEventRow {
                id,
                action,
                previous_score,
                new_score,
                previous_status,
                new_status,
                reason,
                changed_at,
                changed_by,
            },
        )
        .collect())
}

/// All events for a learner in a course (instructor view).
pub async fn list_for_student_in_course(
    pool: &PgPool,
    course_id: Uuid,
    student_id: Uuid,
) -> Result<Vec<GradeAuditEventRow>, sqlx::Error> {
    let rows: Vec<(
        Uuid,
        String,
        Option<Decimal>,
        Option<Decimal>,
        Option<String>,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
        Option<Uuid>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT
            id, action, previous_score, new_score, previous_status, new_status, reason, changed_at,
            changed_by_user_id
        FROM {}
        WHERE course_id = $1 AND student_id = $2
        ORDER BY changed_at DESC, id DESC
        "#,
        schema::GRADE_AUDIT_EVENTS
    ))
    .bind(course_id)
    .bind(student_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                action,
                previous_score,
                new_score,
                previous_status,
                new_status,
                reason,
                changed_at,
                changed_by,
            )| GradeAuditEventRow {
                id,
                action,
                previous_score,
                new_score,
                previous_status,
                new_status,
                reason,
                changed_at,
                changed_by,
            },
        )
        .collect())
}

pub async fn posted_at_for_cell(
    pool: &PgPool,
    course_id: Uuid,
    assignment_id: Uuid,
    student_id: Uuid,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    let v: Option<Option<DateTime<Utc>>> = sqlx::query_scalar(&format!(
        r#"
        SELECT posted_at FROM {}
        WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3
        "#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .bind(student_id)
    .bind(assignment_id)
    .fetch_optional(pool)
    .await?;
    Ok(v.flatten())
}

#[cfg(test)]
mod tests {
    use super::grade_cell_id;
    use uuid::Uuid;

    #[test]
    fn grade_cell_id_is_deterministic() {
        let c = Uuid::from_u128(0x1);
        let a = Uuid::from_u128(0x2);
        let s = Uuid::from_u128(0x3);
        assert_eq!(grade_cell_id(c, a, s), grade_cell_id(c, a, s));
    }

    #[test]
    fn grade_cell_id_differs_by_student() {
        let c = Uuid::from_u128(0x10);
        let a = Uuid::from_u128(0x20);
        let s1 = Uuid::from_u128(0x30);
        let s2 = Uuid::from_u128(0x31);
        assert_ne!(grade_cell_id(c, a, s1), grade_cell_id(c, a, s2));
    }
}
