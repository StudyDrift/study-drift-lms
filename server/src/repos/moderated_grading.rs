//! Queries for moderated grading reconciliation and gradebook gating (plan 3.4).

use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

/// Submissions where at least two provisional scores disagree beyond the threshold and the
/// corresponding `course_grades` row has not been reconciled yet (`reconciliation_source` IS NULL).
pub async fn count_flagged_unreconciled(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    points_worth: i32,
    threshold_pct: i32,
) -> Result<i64, sqlx::Error> {
    let pw = points_worth.max(1) as f64;
    let th = threshold_pct.clamp(0, 100) as f64;
    let n: Option<i64> = sqlx::query_scalar(&format!(
        r#"
        WITH agg AS (
            SELECT pg.submission_id,
                   COUNT(*)::bigint AS n,
                   MIN(pg.score) AS mn,
                   MAX(pg.score) AS mx
            FROM {pg} pg
            INNER JOIN {sub} s ON s.id = pg.submission_id
            WHERE s.course_id = $1 AND s.module_item_id = $2
            GROUP BY pg.submission_id
        )
        SELECT COUNT(*)::bigint
        FROM {sub} s
        INNER JOIN agg a ON a.submission_id = s.id
        LEFT JOIN {grades} g
          ON g.course_id = s.course_id
         AND g.module_item_id = s.module_item_id
         AND g.student_user_id = s.submitted_by
        WHERE s.course_id = $1
          AND s.module_item_id = $2
          AND a.n >= 2
          AND (a.mx - a.mn) > ($3::double precision * $4::double precision / 100.0)
          AND g.reconciliation_source IS NULL
        "#,
        pg = schema::PROVISIONAL_GRADES,
        sub = schema::MODULE_ASSIGNMENT_SUBMISSIONS,
        grades = schema::COURSE_GRADES,
    ))
    .bind(course_id)
    .bind(module_item_id)
    .bind(pw)
    .bind(th)
    .fetch_one(pool)
    .await?;
    Ok(n.unwrap_or(0))
}
