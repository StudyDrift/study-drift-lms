//! Instructor-entered points in the course gradebook (`course.course_grades`).

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::{json, Value as JsonValue};
use sqlx::postgres::PgConnection;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::repos::course_module_assignments;
use crate::repos::grade_audit_events;

/// Bulk gradebook write: (student, item, points, rubric, set_excused).
/// `set_excused = None` means preserve excused (or default false on insert) except when
/// `upsert_and_delete` clears it because points or rubric changed.
pub type GradebookUpsertOp = (Uuid, Uuid, Option<f64>, Option<HashMap<Uuid, f64>>, Option<bool>);

/// All stored grades for a course: point cells, optional rubric scores, and per-cell `posted_at` (3.8).
pub async fn list_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<
    (
        HashMap<Uuid, HashMap<Uuid, String>>,
        HashMap<Uuid, HashMap<Uuid, HashMap<Uuid, String>>>,
        HashMap<Uuid, HashMap<Uuid, Option<DateTime<Utc>>>>,
        HashMap<Uuid, HashMap<Uuid, bool>>,
    ),
    sqlx::Error,
> {
    let rows: Vec<(
        Uuid,
        Uuid,
        f64,
        Option<JsonValue>,
        Option<DateTime<Utc>>,
        bool,
    )> = sqlx::query_as(
        &format!(
            r#"
        SELECT student_user_id, module_item_id, points_earned, rubric_scores_json, posted_at, excused
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
    let mut excused_out: HashMap<Uuid, HashMap<Uuid, bool>> = HashMap::new();

    for (user_id, item_id, pts, rubric_json, posted_at, excused) in rows {
        let s = format_points_for_cell(pts);
        out.entry(user_id).or_default().insert(item_id, s);
        posted_out
            .entry(user_id)
            .or_default()
            .insert(item_id, posted_at);
        excused_out
            .entry(user_id)
            .or_default()
            .insert(item_id, excused);

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

    Ok((out, rubric_out, posted_out, excused_out))
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
          AND NOT excused
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
              AND NOT cg.excused
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
              AND NOT excused
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

fn posting_status_label(posted_at: Option<DateTime<Utc>>) -> &'static str {
    if posted_at.is_some() {
        "posted"
    } else {
        "unposted"
    }
}

/// Apply grade updates: `None` removes a stored grade; `Some` inserts or updates.
/// `rubric_scores`: `None` leaves rubric column unchanged when updating points only (not used — we always pass explicit).
/// `set_excused` (`op.4`): `None` preserves excused unless points or rubric change (then clears excusal).
/// For each op: when `points` is `None`, row is deleted. When `Some`, rubric map is stored (empty map clears rubric scores).
pub async fn upsert_and_delete(
    pool: &PgPool,
    course_id: Uuid,
    ops: &[GradebookUpsertOp],
    changed_by: Option<Uuid>,
    change_reason: Option<&str>,
) -> Result<(), sqlx::Error> {
    let item_ids: Vec<Uuid> = {
        let mut s: Vec<Uuid> = ops.iter().map(|(_, i, _, _, _)| *i).collect();
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

    let all_keys: Vec<(Uuid, Uuid)> = {
        let mut s: Vec<_> = ops.iter().map(|(u, i, _, _, _)| (*u, *i)).collect();
        s.sort();
        s.dedup();
        s
    };
    let mut prior_cells: HashMap<
        (Uuid, Uuid),
        (f64, Option<DateTime<Utc>>, Option<serde_json::Value>, bool),
    > = HashMap::new();
    if !all_keys.is_empty() {
        let uids: Vec<Uuid> = all_keys.iter().map(|(a, _)| *a).collect();
        let iids: Vec<Uuid> = all_keys.iter().map(|(_, b)| *b).collect();
        let rows: Vec<(
            Uuid,
            Uuid,
            f64,
            Option<DateTime<Utc>>,
            Option<serde_json::Value>,
            bool,
        )> = sqlx::query_as(&format!(
            r#"
            SELECT student_user_id, module_item_id, points_earned, posted_at, rubric_scores_json, excused
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
        for (su, mi, pe, pa, rj, ex) in rows {
            prior_cells.insert((su, mi), (pe, pa, rj, ex));
        }
    }
    let mut prior_posted: HashMap<(Uuid, Uuid), Option<DateTime<Utc>>> = HashMap::new();
    for (k, (_, posted_at, _, _)) in &prior_cells {
        prior_posted.insert(*k, *posted_at);
    }

    let now = Utc::now();
    let mut tx = pool.begin().await?;
    for (user_id, item_id, pts, rubric_scores, set_excused) in ops {
        let is_manual = policies
            .get(item_id)
            .is_some_and(|(p, _)| p == "manual");
        match pts {
            None => {
                let n = sqlx::query(&format!(
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
                .await?
                .rows_affected();
                if n == 0 {
                    continue;
                }
                if let Some((p, posted_at, _, _)) = prior_cells.get(&(*user_id, *item_id)).cloned() {
                    grade_audit_events::insert(
                        &mut *tx,
                        course_id,
                        *item_id,
                        *user_id,
                        changed_by,
                        "deleted",
                        Some(p),
                        None,
                        Some(posting_status_label(posted_at)),
                        None,
                        change_reason,
                    )
                    .await?;
                }
            }
            Some(p) => {
                let rubric_json: Option<JsonValue> = match rubric_scores {
                    None => None,
                    Some(m) if m.is_empty() => None,
                    Some(m) => Some(json!(m)),
                };
                let rubric_for_compare = rubric_json.clone();
                let prior = prior_cells.get(&(*user_id, *item_id)).cloned();
                let posted_at = if is_manual {
                    prior_posted
                        .get(&(*user_id, *item_id))
                        .copied()
                        .flatten()
                } else {
                    Some(now)
                };
                let new_status = posting_status_label(posted_at);
                let (old_ex, new_excused) = match &prior {
                    Some((op, _opa, prev_rj, ex)) => {
                        let rubric_changed = prev_rj != &rubric_for_compare;
                        let points_changed = (op - p).abs() > 1e-9;
                        let should_clear = *ex && set_excused.is_none() && (points_changed || rubric_changed);
                        let ne = match set_excused {
                            Some(b) => *b,
                            None if should_clear => false,
                            None => *ex,
                        };
                        (*ex, ne)
                    }
                    None => (false, set_excused.unwrap_or(false)),
                };
                sqlx::query(&format!(
                    r#"
                    INSERT INTO {} AS cg (course_id, student_user_id, module_item_id, points_earned, rubric_scores_json, posted_at, excused)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (student_user_id, module_item_id)
                    DO UPDATE SET
                        course_id = EXCLUDED.course_id,
                        points_earned = EXCLUDED.points_earned,
                        rubric_scores_json = EXCLUDED.rubric_scores_json,
                        posted_at = EXCLUDED.posted_at,
                        excused = EXCLUDED.excused,
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
                .bind(new_excused)
                .execute(&mut *tx)
                .await?;

                if let Some((old_pts, old_posted_at, prev_rj, _prior_ex)) = &prior {
                    let old_lbl = posting_status_label(*old_posted_at);
                    let new_lbl = new_status;
                    let rubric_changed = prev_rj != &rubric_for_compare;
                    let points_changed = (old_pts - p).abs() > 1e-9;
                    let status_changed = old_lbl != new_lbl;
                    let default_reason: Option<String> = if !points_changed && !status_changed && rubric_changed {
                        Some("Rubric update".into())
                    } else {
                        None
                    };
                    let reason = change_reason
                        .map(String::from)
                        .or(default_reason);
                    if points_changed || rubric_changed || status_changed {
                        grade_audit_events::insert(
                            &mut *tx,
                            course_id,
                            *item_id,
                            *user_id,
                            changed_by,
                            "updated",
                            Some(*old_pts),
                            Some(*p),
                            Some(old_lbl),
                            Some(new_lbl),
                            reason.as_deref(),
                        )
                        .await?;
                    }
                    if new_excused != old_ex {
                        let a = if new_excused { "excused" } else { "unexcused" };
                        grade_audit_events::insert(
                            &mut *tx,
                            course_id,
                            *item_id,
                            *user_id,
                            changed_by,
                            a,
                            Some(*old_pts),
                            Some(*p),
                            if old_ex { Some("excused") } else { Some("unexcused") },
                            if new_excused { Some("excused") } else { Some("unexcused") },
                            change_reason,
                        )
                        .await?;
                    }
                } else {
                    grade_audit_events::insert(
                        &mut *tx,
                        course_id,
                        *item_id,
                        *user_id,
                        changed_by,
                        "created",
                        None,
                        Some(*p),
                        None,
                        Some(new_status),
                        change_reason,
                    )
                    .await?;
                }
            }
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Single-cell upsert for automated quiz scoring (clears rubric scores). System-originated (`changed_by` None).
pub async fn upsert_points(
    pool: &PgPool,
    course_id: Uuid,
    student_user_id: Uuid,
    module_item_id: Uuid,
    points: f64,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let prior: Option<(f64, Option<DateTime<Utc>>)> = sqlx::query_as(&format!(
        r#"
        SELECT points_earned, posted_at
        FROM {}
        WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3
        "#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .bind(student_user_id)
    .bind(module_item_id)
    .fetch_optional(&mut *tx)
    .await?;
    sqlx::query(&format!(
        r#"
        INSERT INTO {} AS cg (course_id, student_user_id, module_item_id, points_earned, rubric_scores_json, posted_at, excused)
        VALUES ($1, $2, $3, $4, NULL, NOW(), FALSE)
        ON CONFLICT (student_user_id, module_item_id)
        DO UPDATE SET
            course_id = EXCLUDED.course_id,
            points_earned = EXCLUDED.points_earned,
            rubric_scores_json = NULL,
            excused = FALSE,
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
    .execute(&mut *tx)
    .await?;
    // Quizzes are automatic posting; the row ends with `posted_at` set to NOW.
    let new_s = "posted";
    if prior.is_none() {
        grade_audit_events::insert(
            &mut *tx,
            course_id,
            module_item_id,
            student_user_id,
            None,
            "created",
            None,
            Some(points),
            None,
            Some(new_s),
            Some("Quiz / auto-score"),
        )
        .await?;
    } else {
        let (op, opa) = prior.expect("prior");
        let old_s = posting_status_label(opa);
        grade_audit_events::insert(
            &mut *tx,
            course_id,
            module_item_id,
            student_user_id,
            None,
            "updated",
            Some(op),
            Some(points),
            Some(old_s),
            Some(new_s),
            Some("Quiz / auto-score"),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Writes the visible gradebook cell and reconciliation metadata (plan 3.4).
/// Plan 3.8: initial reconciled row is held when posting policy is manual.
/// `audit_reason` is stored on the grade audit (e.g. moderator action + context).
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
    audit_reason: &str,
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
    let mut tx = pool.begin().await?;
    let prior: Option<(f64, Option<DateTime<Utc>>, Option<serde_json::Value>)> = sqlx::query_as(
        &format!(
            r#"
            SELECT points_earned, posted_at, rubric_scores_json
            FROM {}
            WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3
            "#,
            schema::COURSE_GRADES
        ),
    )
    .bind(course_id)
    .bind(student_user_id)
    .bind(module_item_id)
    .fetch_optional(&mut *tx)
    .await?;
    // `prior` is reused for audit: clone `posted_at` without moving `prior`.
    let prior_posted: Option<Option<DateTime<Utc>>> =
        prior.as_ref()
            .map(|(_, p_at, _)| p_at.clone());
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
            reconciliation_source, reconciled_grader_id, reconciled_by, reconciled_at, posted_at, excused
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE)
        ON CONFLICT (student_user_id, module_item_id)
        DO UPDATE SET
            course_id = EXCLUDED.course_id,
            points_earned = EXCLUDED.points_earned,
            rubric_scores_json = EXCLUDED.rubric_scores_json,
            reconciliation_source = EXCLUDED.reconciliation_source,
            reconciled_grader_id = EXCLUDED.reconciled_grader_id,
            reconciled_by = EXCLUDED.reconciled_by,
            reconciled_at = EXCLUDED.reconciled_at,
            excused = cg.excused,
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
    .execute(&mut *tx)
    .await?;
    let new_l = posting_status_label(posted_at);
    let r = if audit_reason.is_empty() {
        None
    } else {
        Some(audit_reason)
    };
    if prior.is_none() {
        grade_audit_events::insert(
            &mut *tx,
            course_id,
            module_item_id,
            student_user_id,
            Some(reconciled_by),
            "created",
            None,
            Some(points),
            None,
            Some(new_l),
            r,
        )
        .await?;
    } else {
        let (old_p, old_pa, _) = prior.expect("prior");
        let old_l = posting_status_label(old_pa);
        grade_audit_events::insert(
            &mut *tx,
            course_id,
            module_item_id,
            student_user_id,
            Some(reconciled_by),
            "updated",
            Some(old_p),
            Some(points),
            Some(old_l),
            Some(new_l),
            r,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Set `posted_at` on held cells for an assignment. Returns affected students and their points.
pub async fn mark_posted(
    conn: &mut PgConnection,
    course_id: Uuid,
    module_item_id: Uuid,
    at: DateTime<Utc>,
    only_students: Option<&[Uuid]>,
) -> Result<Vec<(Uuid, f64)>, sqlx::Error> {
    let out: Vec<(Uuid, f64)> = if let Some(sids) = only_students {
        if sids.is_empty() {
            return Ok(Vec::new());
        }
        let rows: Vec<(Uuid, f64)> = sqlx::query_as(&format!(
            r#"
            UPDATE {}
            SET posted_at = $4, updated_at = NOW()
            WHERE course_id = $1 AND module_item_id = $2
              AND posted_at IS NULL
              AND student_user_id = ANY($3)
            RETURNING student_user_id, points_earned
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(module_item_id)
        .bind(sids)
        .bind(at)
        .fetch_all(&mut *conn)
        .await?;
        rows
    } else {
        let rows: Vec<(Uuid, f64)> = sqlx::query_as(&format!(
            r#"
            UPDATE {}
            SET posted_at = $3, updated_at = NOW()
            WHERE course_id = $1 AND module_item_id = $2
              AND posted_at IS NULL
            RETURNING student_user_id, points_earned
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(module_item_id)
        .bind(at)
        .fetch_all(&mut *conn)
        .await?;
        rows
    };
    Ok(out)
}

/// Retract posted grades (3.8); returns affected students and their points.
pub async fn mark_unposted(
    conn: &mut PgConnection,
    course_id: Uuid,
    module_item_id: Uuid,
    only_students: Option<&[Uuid]>,
) -> Result<Vec<(Uuid, f64)>, sqlx::Error> {
    let out: Vec<(Uuid, f64)> = if let Some(sids) = only_students {
        if sids.is_empty() {
            return Ok(Vec::new());
        }
        let rows: Vec<(Uuid, f64)> = sqlx::query_as(&format!(
            r#"
            UPDATE {}
            SET posted_at = NULL, updated_at = NOW()
            WHERE course_id = $1 AND module_item_id = $2
              AND posted_at IS NOT NULL
              AND student_user_id = ANY($3)
            RETURNING student_user_id, points_earned
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(module_item_id)
        .bind(sids)
        .fetch_all(&mut *conn)
        .await?;
        rows
    } else {
        let rows: Vec<(Uuid, f64)> = sqlx::query_as(&format!(
            r#"
            UPDATE {}
            SET posted_at = NULL, updated_at = NOW()
            WHERE course_id = $1 AND module_item_id = $2
              AND posted_at IS NOT NULL
            RETURNING student_user_id, points_earned
            "#,
            schema::COURSE_GRADES
        ))
        .bind(course_id)
        .bind(module_item_id)
        .fetch_all(&mut *conn)
        .await?;
        rows
    };
    Ok(out)
}

/// Set excused for one gradebook cell. Inserts 0 points when the row is missing and `excused` is set true.
/// Plan 3.12: audit with `action` excused / unexcused; optional `reason` (FERPA / instructor note).
pub async fn set_excused_for_cell(
    pool: &PgPool,
    course_id: Uuid,
    student_user_id: Uuid,
    module_item_id: Uuid,
    excused: bool,
    changed_by: Uuid,
    reason: Option<&str>,
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
    let mut tx = pool.begin().await?;
    let prior: Option<(f64, Option<DateTime<Utc>>, Option<serde_json::Value>, bool)> = sqlx::query_as(
        &format!(
            r#"
            SELECT points_earned, posted_at, rubric_scores_json, excused
            FROM {}
            WHERE course_id = $1 AND student_user_id = $2 AND module_item_id = $3
            "#,
            schema::COURSE_GRADES
        ),
    )
    .bind(course_id)
    .bind(student_user_id)
    .bind(module_item_id)
    .fetch_optional(&mut *tx)
    .await?;
    let prior_ex = prior.as_ref().is_some_and(|(_, _, _, e)| *e);
    if prior.is_some() && prior_ex == excused {
        tx.commit().await?;
        return Ok(());
    }
    let posted_at: Option<DateTime<Utc>> = match &prior {
        None => {
            if is_manual {
                None
            } else {
                Some(now)
            }
        }
        Some((_, pa, _, _)) => *pa,
    };
    let points: f64 = match &prior {
        None if excused => 0.0,
        None => {
            tx.commit().await?;
            return Ok(());
        }
        Some((p, _, _, _)) => *p,
    };
    let rubric_json: Option<JsonValue> = match &prior {
        Some((_, _, r, _)) => r.clone(),
        None => None,
    };
    sqlx::query(&format!(
        r#"
        INSERT INTO {} AS cg (course_id, student_user_id, module_item_id, points_earned, rubric_scores_json, posted_at, excused)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (student_user_id, module_item_id)
        DO UPDATE SET
            excused = EXCLUDED.excused,
            updated_at = NOW()
        "#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .bind(student_user_id)
    .bind(module_item_id)
    .bind(points)
    .bind(rubric_json)
    .bind(posted_at)
    .bind(excused)
    .execute(&mut *tx)
    .await?;
    let a = if excused { "excused" } else { "unexcused" };
    grade_audit_events::insert(
        &mut *tx,
        course_id,
        module_item_id,
        student_user_id,
        Some(changed_by),
        a,
        Some(points),
        Some(points),
        if prior_ex { Some("excused") } else { Some("unexcused") },
        if excused { Some("excused") } else { Some("unexcused") },
        reason,
    )
    .await?;
    tracing::info!(
        target: "grade_excusal",
        %course_id,
        %module_item_id,
        %student_user_id,
        excused,
        "grade_excused_state_toggled"
    );
    tx.commit().await?;
    Ok(())
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
