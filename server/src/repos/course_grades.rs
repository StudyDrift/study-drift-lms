//! Instructor-entered points in the course gradebook (`course.course_grades`).

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::{json, Value as JsonValue};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::repos::course_module_assignments;

/// All stored grades for a course: point cells, optional rubric scores, and per-cell `posted_at` (3.8).
pub async fn list_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<
    (
        HashMap<Uuid, HashMap<Uuid, String>>,
        HashMap<Uuid, HashMap<Uuid, HashMap<Uuid, String>>>,
        HashMap<Uuid, HashMap<Uuid, Option<DateTime<Utc>>>>,
    ),
    sqlx::Error,
> {
    let rows: Vec<(Uuid, Uuid, f64, Option<JsonValue>, Option<DateTime<Utc>>)> = sqlx::query_as(
        &format!(
            r#"
        SELECT student_user_id, module_item_id, points_earned, rubric_scores_json, posted_at
        FROM {}
        WHERE course_id = $1
        "#,
            schema::COURSE_GRADES
        ),
    )
    .bind(course_id)
    .fetch_all(pool)
    .await?;

    let mut out: HashMap<Uuid, HashMap<Uuid, String>> = HashMap::new();
    let mut rubric_out: HashMap<Uuid, HashMap<Uuid, HashMap<Uuid, String>>> = HashMap::new();
    let mut posted_out: HashMap<Uuid, HashMap<Uuid, Option<DateTime<Utc>>>> = HashMap::new();

    for (user_id, item_id, pts, rubric_json, posted_at) in rows {
        let s = format_points_for_cell(pts);
        out.entry(user_id).or_default().insert(item_id, s);
        posted_out
            .entry(user_id)
            .or_default()
            .insert(item_id, posted_at);

        if let Some(j) = rubric_json {
            if let Ok(m) = serde_json::from_value::<HashMap<Uuid, f64>>(j) {
                for (crit_id, p) in m {
                    rubric_out
                        .entry(user_id)
                        .or_default()
                        .entry(item_id)
                        .or_default()
                        .insert(crit_id, format_points_for_cell(p));
                }
            }
        }
    }

    Ok((out, rubric_out, posted_out))
}

/// Raw cells for SBG proficiency rollups (plan 3.7).
pub async fn list_raw_for_course_sbg(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<
    Vec<(
        Uuid,
        Uuid,
        f64,
        Option<serde_json::Value>,
        DateTime<Utc>,
    )>,
    sqlx::Error,
> {
    let rows: Vec<(
        Uuid,
        Uuid,
        f64,
        Option<serde_json::Value>,
        DateTime<Utc>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT student_user_id, module_item_id, points_earned, rubric_scores_json, updated_at
        FROM {}
        WHERE course_id = $1
        "#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Grade cells for a single student (SBG recompute, plan 3.7).
/// When `student_visible` is true, rows hidden by manual grade posting (unposted) are excluded.
pub async fn list_raw_for_student_sbg(
    pool: &PgPool,
    course_id: Uuid,
    student_id: Uuid,
    student_visible: bool,
) -> Result<
    Vec<(
        Uuid,
        f64,
        Option<serde_json::Value>,
        DateTime<Utc>,
    )>,
    sqlx::Error,
> {
    let q = if student_visible {
        format!(
            r#"
            SELECT cg.module_item_id, cg.points_earned, cg.rubric_scores_json, cg.updated_at
            FROM {} cg
            INNER JOIN {} c ON c.id = cg.module_item_id AND c.course_id = cg.course_id
            LEFT JOIN {} m ON m.structure_item_id = c.id AND c.kind = 'assignment'
            WHERE cg.course_id = $1 AND cg.student_user_id = $2
              AND (
                c.kind = 'quiz'
                OR m.posting_policy = 'automatic'
                OR (m.posting_policy = 'manual' AND cg.posted_at IS NOT NULL)
            )
            "#,
            schema::COURSE_GRADES,
            schema::COURSE_STRUCTURE_ITEMS,
            schema::MODULE_ASSIGNMENTS
        )
    } else {
        format!(
            r#"
            SELECT module_item_id, points_earned, rubric_scores_json, updated_at
            FROM {}
            WHERE course_id = $1 AND student_user_id = $2
            "#,
            schema::COURSE_GRADES
        )
    };
    let rows: Vec<(
        Uuid,
        f64,
        Option<serde_json::Value>,
        DateTime<Utc>,
    )> = sqlx::query_as(&q)
    .bind(course_id)
    .bind(student_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

fn format_points_for_cell(pts: f64) -> String {
    if !pts.is_finite() || pts < 0.0 {
        return String::new();
    }
    let i = pts as i64;
    if (pts - i as f64).abs() < 1e-9 {
        return i.to_string();
    }
    let mut s = format!("{:.4}", pts);
    while s.contains('.') && (s.ends_with('0') || s.ends_with('.')) {
        s.pop();
    }
    s
}

/// Apply grade updates: `None` removes a stored grade; `Some` inserts or updates.
/// `rubric_scores`: `None` leaves rubric column unchanged when updating points only (not used — we always pass explicit).
/// For each op: when `points` is `None`, row is deleted. When `Some`, rubric map is stored (empty map clears rubric scores).
pub async fn upsert_and_delete(
    pool: &PgPool,
    course_id: Uuid,
    ops: &[(Uuid, Uuid, Option<f64>, Option<HashMap<Uuid, f64>>)],
) -> Result<(), sqlx::Error> {
    let item_ids: Vec<Uuid> = {
        let mut s: Vec<Uuid> = ops.iter().map(|(_, i, _, _)| *i).collect();
        s.sort();
        s.dedup();
        s
    };
    let policies = course_module_assignments::posting_settings_for_structure_items(
        pool,
        course_id,
        &item_ids,
    )
    .await?;

    let need_existing: Vec<(Uuid, Uuid)> = ops
        .iter()
        .filter_map(|(u, i, p, _)| p.map(|_| (*u, *i)))
        .collect();
    let mut prior_posted: HashMap<(Uuid, Uuid), Option<DateTime<Utc>>> = HashMap::new();
    if !need_existing.is_empty() {
        let uids: Vec<Uuid> = need_existing.iter().map(|(a, _)| *a).collect();
        let iids: Vec<Uuid> = need_existing.iter().map(|(_, b)| *b).collect();
        let rows: Vec<(Uuid, Uuid, Option<DateTime<Utc>>)> = sqlx::query_as(&format!(
            r#"
            SELECT student_user_id, module_item_id, posted_at
            FROM {}
            WHERE course_id = $1
              AND (student_user_id, module_item_id) IN (
                SELECT * FROM UNNEST($2::uuid[], $3::uuid[]) AS t(s, m)
              )
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(&uids)
        .bind(&iids)
        .fetch_all(pool)
        .await?;
        for (su, mi, pa) in rows {
            prior_posted.insert((su, mi), pa);
        }
    }

    let now = Utc::now();
    let mut tx = pool.begin().await?;
    for (user_id, item_id, pts, rubric_scores) in ops {
        let is_manual = policies
            .get(item_id)
            .is_some_and(|(p, _)| p == "manual");
        match pts {
            None => {
                sqlx::query(&format!(
                    r#"
                    DELETE FROM {}
                    WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3
                    "#,
                    schema::COURSE_GRADES
                ))
                .bind(course_id)
                .bind(user_id)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
            }
            Some(p) => {
                let rubric_json: Option<JsonValue> = match rubric_scores {
                    None => None,
                    Some(m) if m.is_empty() => None,
                    Some(m) => Some(json!(m)),
                };
                let posted_at = if is_manual {
                    prior_posted
                        .get(&(*user_id, *item_id))
                        .copied()
                        .flatten()
                } else {
                    Some(now)
                };
                sqlx::query(&format!(
                    r#"
                    INSERT INTO {} AS cg (course_id, student_user_id, module_item_id, points_earned, rubric_scores_json, posted_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (student_user_id, module_item_id)
                    DO UPDATE SET
                        course_id = EXCLUDED.course_id,
                        points_earned = EXCLUDED.points_earned,
                        rubric_scores_json = EXCLUDED.rubric_scores_json,
                        posted_at = EXCLUDED.posted_at,
                        settings_version = cg.settings_version + (
                            CASE
                                WHEN EXCLUDED.rubric_scores_json IS DISTINCT FROM cg.rubric_scores_json THEN 1
                                ELSE 0
                            END
                        ),
                        updated_at = NOW()
                    "#,
                    schema::COURSE_GRADES
                ))
                .bind(course_id)
                .bind(user_id)
                .bind(item_id)
                .bind(*p)
                .bind(rubric_json)
                .bind(posted_at)
                .execute(&mut *tx)
                .await?;
            }
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Single-cell upsert for automated quiz scoring (clears rubric scores).
pub async fn upsert_points(
    pool: &PgPool,
    course_id: Uuid,
    student_user_id: Uuid,
    module_item_id: Uuid,
    points: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} AS cg (course_id, student_user_id, module_item_id, points_earned, rubric_scores_json, posted_at)
        VALUES ($1, $2, $3, $4, NULL, NOW())
        ON CONFLICT (student_user_id, module_item_id)
        DO UPDATE SET
            course_id = EXCLUDED.course_id,
            points_earned = EXCLUDED.points_earned,
            rubric_scores_json = NULL,
            posted_at = NOW(),
            settings_version = cg.settings_version + (
                CASE
                    WHEN EXCLUDED.rubric_scores_json IS DISTINCT FROM cg.rubric_scores_json THEN 1
                    ELSE 0
                END
            ),
            updated_at = NOW()
        "#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .bind(student_user_id)
    .bind(module_item_id)
    .bind(points)
    .execute(pool)
    .await?;
    Ok(())
}

/// Writes the visible gradebook cell and reconciliation metadata (plan 3.4).
/// Plan 3.8: initial reconciled row is held when posting policy is manual.
pub async fn upsert_reconciled_final(
    pool: &PgPool,
    course_id: Uuid,
    student_user_id: Uuid,
    module_item_id: Uuid,
    points: f64,
    rubric_scores: Option<&HashMap<Uuid, f64>>,
    reconciliation_source: &str,
    reconciled_grader_id: Option<Uuid>,
    reconciled_by: Uuid,
    reconciled_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let pol = course_module_assignments::posting_settings_for_structure_items(
        pool,
        course_id,
        &[module_item_id],
    )
    .await?;
    let is_manual = pol
        .get(&module_item_id)
        .is_some_and(|(p, _)| p == "manual");
    let now = Utc::now();
    let prior_posted: Option<Option<DateTime<Utc>>> = sqlx::query_scalar(&format!(
        r#"SELECT posted_at FROM {} WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3"#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .bind(student_user_id)
    .bind(module_item_id)
    .fetch_optional(pool)
    .await?;
    let posted_at: Option<DateTime<Utc>> = if is_manual {
        match prior_posted {
            None => None,
            Some(inside) => inside,
        }
    } else {
        Some(now)
    };
    let rubric_json: Option<JsonValue> = match rubric_scores {
        None => None,
        Some(m) if m.is_empty() => None,
        Some(m) => Some(json!(m)),
    };
    sqlx::query(&format!(
        r#"
        INSERT INTO {} AS cg (
            course_id, student_user_id, module_item_id, points_earned, rubric_scores_json,
            reconciliation_source, reconciled_grader_id, reconciled_by, reconciled_at, posted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (student_user_id, module_item_id)
        DO UPDATE SET
            course_id = EXCLUDED.course_id,
            points_earned = EXCLUDED.points_earned,
            rubric_scores_json = EXCLUDED.rubric_scores_json,
            reconciliation_source = EXCLUDED.reconciliation_source,
            reconciled_grader_id = EXCLUDED.reconciled_grader_id,
            reconciled_by = EXCLUDED.reconciled_by,
            reconciled_at = EXCLUDED.reconciled_at,
            posted_at = CASE
                WHEN $11::bool THEN COALESCE(cg.posted_at, EXCLUDED.posted_at)
                ELSE EXCLUDED.posted_at
            END,
            settings_version = cg.settings_version + 1,
            updated_at = NOW()
        "#,
        schema::COURSE_GRADES,
    ))
    .bind(course_id)
    .bind(student_user_id)
    .bind(module_item_id)
    .bind(points)
    .bind(rubric_json)
    .bind(reconciliation_source)
    .bind(reconciled_grader_id)
    .bind(reconciled_by)
    .bind(reconciled_at)
    .bind(posted_at)
    .bind(is_manual)
    .execute(pool)
    .await?;
    Ok(())
}

/// Set `posted_at` on held cells for an assignment. Returns affected `student_user_id` values.
pub async fn mark_posted(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    at: DateTime<Utc>,
    only_students: Option<&[Uuid]>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let out: Vec<Uuid> = if let Some(sids) = only_students {
        if sids.is_empty() {
            return Ok(Vec::new());
        }
        let rows: Vec<(Uuid,)> = sqlx::query_as(&format!(
            r#"
            UPDATE {}
            SET posted_at = $4, updated_at = NOW()
            WHERE course_id = $1 AND module_item_id = $2
              AND posted_at IS NULL
              AND student_user_id = ANY($3)
            RETURNING student_user_id
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(module_item_id)
        .bind(sids)
        .bind(at)
        .fetch_all(pool)
        .await?;
        rows.into_iter().map(|(u,)| u).collect()
    } else {
        let rows: Vec<(Uuid,)> = sqlx::query_as(&format!(
            r#"
            UPDATE {}
            SET posted_at = $3, updated_at = NOW()
            WHERE course_id = $1 AND module_item_id = $2
              AND posted_at IS NULL
            RETURNING student_user_id
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(module_item_id)
        .bind(at)
        .fetch_all(pool)
        .await?;
        rows.into_iter().map(|(u,)| u).collect()
    };
    Ok(out)
}

/// Retract posted grades (3.8); returns affected `student_user_id` values.
pub async fn mark_unposted(
    pool: &PgPool,
    course_id: Uuid,
    module_item_id: Uuid,
    only_students: Option<&[Uuid]>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let out: Vec<Uuid> = if let Some(sids) = only_students {
        if sids.is_empty() {
            return Ok(Vec::new());
        }
        let rows: Vec<(Uuid,)> = sqlx::query_as(&format!(
            r#"
            UPDATE {}
            SET posted_at = NULL, updated_at = NOW()
            WHERE course_id = $1 AND module_item_id = $2
              AND posted_at IS NOT NULL
              AND student_user_id = ANY($3)
            RETURNING student_user_id
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(module_item_id)
        .bind(sids)
        .fetch_all(pool)
        .await?;
        rows.into_iter().map(|(u,)| u).collect()
    } else {
        let rows: Vec<(Uuid,)> = sqlx::query_as(&format!(
            r#"
            UPDATE {}
            SET posted_at = NULL, updated_at = NOW()
            WHERE course_id = $1 AND module_item_id = $2
              AND posted_at IS NOT NULL
            RETURNING student_user_id
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(module_item_id)
        .fetch_all(pool)
        .await?;
        rows.into_iter().map(|(u,)| u).collect()
    };
    Ok(out)
}

pub async fn row_exists(
    pool: &PgPool,
    course_id: Uuid,
    student_user_id: Uuid,
    module_item_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let v: bool = sqlx::query_scalar(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {}
            WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3
        )
        "#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .bind(student_user_id)
    .bind(module_item_id)
    .fetch_one(pool)
    .await?;
    Ok(v)
}
