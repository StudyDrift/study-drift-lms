//! Instructor-entered points in the course gradebook (`course.course_grades`).

use std::collections::HashMap;

use serde_json::{json, Value as JsonValue};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

/// All stored grades for a course: point cells and optional rubric criterion scores per cell.
pub async fn list_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<
    (
        HashMap<Uuid, HashMap<Uuid, String>>,
        HashMap<Uuid, HashMap<Uuid, HashMap<Uuid, String>>>,
    ),
    sqlx::Error,
> {
    let rows: Vec<(Uuid, Uuid, f64, Option<JsonValue>)> = sqlx::query_as(&format!(
        r#"
        SELECT student_user_id, module_item_id, points_earned, rubric_scores_json
        FROM {}
        WHERE course_id = $1
        "#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await?;

    let mut out: HashMap<Uuid, HashMap<Uuid, String>> = HashMap::new();
    let mut rubric_out: HashMap<Uuid, HashMap<Uuid, HashMap<Uuid, String>>> = HashMap::new();

    for (user_id, item_id, pts, rubric_json) in rows {
        let s = format_points_for_cell(pts);
        out.entry(user_id).or_default().insert(item_id, s);

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

    Ok((out, rubric_out))
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
    let mut tx = pool.begin().await?;
    for (user_id, item_id, pts, rubric_scores) in ops {
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
                sqlx::query(&format!(
                    r#"
                    INSERT INTO {} (course_id, student_user_id, module_item_id, points_earned, rubric_scores_json)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (student_user_id, module_item_id)
                    DO UPDATE SET
                        course_id = EXCLUDED.course_id,
                        points_earned = EXCLUDED.points_earned,
                        rubric_scores_json = EXCLUDED.rubric_scores_json,
                        updated_at = NOW()
                    "#,
                    schema::COURSE_GRADES
                ))
                .bind(course_id)
                .bind(user_id)
                .bind(item_id)
                .bind(*p)
                .bind(rubric_json)
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
        INSERT INTO {} (course_id, student_user_id, module_item_id, points_earned, rubric_scores_json)
        VALUES ($1, $2, $3, $4, NULL)
        ON CONFLICT (student_user_id, module_item_id)
        DO UPDATE SET
            course_id = EXCLUDED.course_id,
            points_earned = EXCLUDED.points_earned,
            rubric_scores_json = NULL,
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
