//! Sequential unlock for competency-based courses: a module tied to an outcome stays hidden
//! until the learner completes assessments linked to the previous ordered outcome.

use std::collections::HashSet;

use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_structure::CourseStructureItemRow;
use crate::repos::course_outcomes;

pub const COURSE_TYPE_COMPETENCY: &str = "competency_based";

async fn assessment_complete_for_student(
    pool: &PgPool,
    course_id: Uuid,
    student_user_id: Uuid,
    item_id: Uuid,
    item_kind: &str,
) -> Result<bool, sqlx::Error> {
    match item_kind {
        "quiz" => {
            let ok: bool = sqlx::query_scalar(&format!(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM {}
                    WHERE course_id = $1
                      AND structure_item_id = $2
                      AND student_user_id = $3
                      AND status = 'submitted'
                )
                "#,
                schema::QUIZ_ATTEMPTS
            ))
            .bind(course_id)
            .bind(item_id)
            .bind(student_user_id)
            .fetch_one(pool)
            .await?;
            Ok(ok)
        }
        "assignment" => {
            let ok: bool = sqlx::query_scalar(&format!(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM {}
                    WHERE course_id = $1
                      AND module_item_id = $2
                      AND student_user_id = $3
                )
                "#,
                schema::COURSE_GRADES
            ))
            .bind(course_id)
            .bind(item_id)
            .bind(student_user_id)
            .fetch_one(pool)
            .await?;
            Ok(ok)
        }
        _ => Ok(true),
    }
}

async fn prev_outcome_gate_complete(
    pool: &PgPool,
    course_id: Uuid,
    student_user_id: Uuid,
    prev_outcome_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let targets = course_outcomes::list_whole_item_links_for_outcome(pool, course_id, prev_outcome_id).await?;
    if targets.is_empty() {
        return Ok(true);
    }
    for (item_id, kind) in targets {
        if !assessment_complete_for_student(pool, course_id, student_user_id, item_id, kind.as_str()).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Module ids that should be hidden for this learner (competency courses only).
pub async fn locked_root_module_ids_for_student(
    pool: &PgPool,
    course_id: Uuid,
    course_type: &str,
    student_user_id: Uuid,
) -> Result<HashSet<Uuid>, sqlx::Error> {
    let mut locked = HashSet::new();
    if course_type != COURSE_TYPE_COMPETENCY {
        return Ok(locked);
    }

    let outcomes = course_outcomes::list_outcomes(pool, course_id).await?;
    let chain: Vec<(Uuid, Uuid)> = outcomes
        .into_iter()
        .filter_map(|o| o.module_structure_item_id.map(|m| (o.id, m)))
        .collect();

    if chain.len() < 2 {
        return Ok(locked);
    }

    for i in 1..chain.len() {
        let (prev_outcome_id, _) = chain[i - 1];
        let (_, module_id) = chain[i];
        if !prev_outcome_gate_complete(pool, course_id, student_user_id, prev_outcome_id).await? {
            locked.insert(module_id);
        }
    }

    Ok(locked)
}

pub async fn student_parent_module_competency_locked(
    pool: &PgPool,
    course_id: Uuid,
    course_type: &str,
    student_user_id: Uuid,
    parent_module_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let locked = locked_root_module_ids_for_student(pool, course_id, course_type, student_user_id).await?;
    Ok(locked.contains(&parent_module_id))
}

/// Removes locked modules and any items that belong to them from the outline payload.
pub async fn filter_structure_rows_for_competency_student(
    pool: &PgPool,
    course_id: Uuid,
    course_type: &str,
    student_user_id: Uuid,
    rows: Vec<CourseStructureItemRow>,
) -> Result<Vec<CourseStructureItemRow>, sqlx::Error> {
    let locked = locked_root_module_ids_for_student(pool, course_id, course_type, student_user_id).await?;
    if locked.is_empty() {
        return Ok(rows);
    }

    Ok(rows
        .into_iter()
        .filter(|r| {
            if r.kind == "module" && r.parent_id.is_none() {
                return !locked.contains(&r.id);
            }
            if let Some(pid) = r.parent_id {
                return !locked.contains(&pid);
            }
            true
        })
        .collect())
}

/// When a module item sits under a parent module, returns true if competency rules hide it for this learner.
pub async fn student_structure_item_competency_blocked_under_parent(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    student_user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let parent_row: Option<Option<Uuid>> = sqlx::query_scalar(&format!(
        r#"SELECT parent_id FROM {} WHERE id = $1 AND course_id = $2"#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;

    let Some(Some(pid)) = parent_row else {
        return Ok(false);
    };

    let course_type: Option<String> = sqlx::query_scalar(&format!(
        r#"SELECT course_type FROM {} WHERE id = $1"#,
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(pool)
    .await?;

    let Some(ct) = course_type else {
        return Ok(false);
    };

    student_parent_module_competency_locked(pool, course_id, &ct, student_user_id, pid).await
}
