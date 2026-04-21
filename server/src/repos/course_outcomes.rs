//! Learning outcomes and links to gradable module items (`course.course_learning_outcomes`,
//! `course.course_outcome_links`).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

/// Allowed `measurement_level` values (see migration `074_course_outcome_link_levels.sql`).
pub const MEASUREMENT_LEVELS: &[&str] = &["diagnostic", "formative", "summative", "performance"];

/// Allowed `intensity_level` values.
pub const INTENSITY_LEVELS: &[&str] = &["low", "medium", "high"];

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LearningOutcomeRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub title: String,
    pub description: String,
    pub sort_order: i32,
    pub module_structure_item_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OutcomeSubOutcomeRow {
    pub id: Uuid,
    pub outcome_id: Uuid,
    pub title: String,
    pub description: String,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OutcomeLinkRow {
    pub id: Uuid,
    pub outcome_id: Uuid,
    pub sub_outcome_id: Option<Uuid>,
    pub structure_item_id: Uuid,
    pub target_kind: String,
    pub quiz_question_id: String,
    pub measurement_level: String,
    pub intensity_level: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OutcomeLinkWithItemRow {
    pub id: Uuid,
    pub outcome_id: Uuid,
    pub sub_outcome_id: Option<Uuid>,
    pub structure_item_id: Uuid,
    pub target_kind: String,
    pub quiz_question_id: String,
    pub measurement_level: String,
    pub intensity_level: String,
    pub created_at: DateTime<Utc>,
    pub item_title: String,
    pub item_kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeLinkProgress {
    pub avg_score_percent: Option<f32>,
    pub graded_learners: i32,
    pub enrolled_learners: i32,
}

pub async fn list_outcomes(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<LearningOutcomeRow>, sqlx::Error> {
    sqlx::query_as::<_, LearningOutcomeRow>(&format!(
        r#"
        SELECT id, course_id, title, description, sort_order, module_structure_item_id, created_at, updated_at
        FROM {}
        WHERE course_id = $1
        ORDER BY sort_order ASC, created_at ASC
        "#,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn list_links_for_outcome(
    pool: &PgPool,
    course_id: Uuid,
    outcome_id: Uuid,
) -> Result<Vec<OutcomeLinkWithItemRow>, sqlx::Error> {
    sqlx::query_as::<_, OutcomeLinkWithItemRow>(&format!(
        r#"
        SELECT
            l.id,
            l.outcome_id,
            l.sub_outcome_id,
            l.structure_item_id,
            l.target_kind,
            l.quiz_question_id,
            l.measurement_level,
            l.intensity_level,
            l.created_at,
            s.title AS item_title,
            s.kind AS item_kind
        FROM {} l
        INNER JOIN {} o ON o.id = l.outcome_id
        INNER JOIN {} s ON s.id = l.structure_item_id
        WHERE o.course_id = $1 AND l.outcome_id = $2
        ORDER BY l.created_at ASC
        "#,
        schema::COURSE_OUTCOME_LINKS,
        schema::COURSE_LEARNING_OUTCOMES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(outcome_id)
    .fetch_all(pool)
    .await
}

pub async fn list_links_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<OutcomeLinkWithItemRow>, sqlx::Error> {
    sqlx::query_as::<_, OutcomeLinkWithItemRow>(&format!(
        r#"
        SELECT
            l.id,
            l.outcome_id,
            l.sub_outcome_id,
            l.structure_item_id,
            l.target_kind,
            l.quiz_question_id,
            l.measurement_level,
            l.intensity_level,
            l.created_at,
            s.title AS item_title,
            s.kind AS item_kind
        FROM {} l
        INNER JOIN {} o ON o.id = l.outcome_id
        INNER JOIN {} s ON s.id = l.structure_item_id
        WHERE o.course_id = $1
        ORDER BY l.outcome_id, l.created_at ASC
        "#,
        schema::COURSE_OUTCOME_LINKS,
        schema::COURSE_LEARNING_OUTCOMES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn insert_outcome(
    pool: &PgPool,
    course_id: Uuid,
    title: &str,
    description: &str,
) -> Result<LearningOutcomeRow, sqlx::Error> {
    let next_sort: i32 = sqlx::query_scalar(&format!(
        r#"SELECT COALESCE(MAX(sort_order), -1) + 1 FROM {} WHERE course_id = $1"#,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(course_id)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, LearningOutcomeRow>(&format!(
        r#"
        INSERT INTO {} (course_id, title, description, sort_order)
        VALUES ($1, $2, $3, $4)
        RETURNING id, course_id, title, description, sort_order, module_structure_item_id, created_at, updated_at
        "#,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(course_id)
    .bind(title)
    .bind(description)
    .bind(next_sort)
    .fetch_one(pool)
    .await
}

pub async fn update_outcome(
    pool: &PgPool,
    course_id: Uuid,
    outcome_id: Uuid,
    title: Option<&str>,
    description: Option<&str>,
    module_structure_item_id: Option<Option<Uuid>>,
) -> Result<Option<LearningOutcomeRow>, sqlx::Error> {
    let Some(cur) = sqlx::query_as::<_, LearningOutcomeRow>(&format!(
        r#"SELECT id, course_id, title, description, sort_order, module_structure_item_id, created_at, updated_at FROM {} WHERE id = $1 AND course_id = $2"#,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(outcome_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };

    let title = match title {
        None => cur.title.as_str(),
        Some(t) => {
            let t = t.trim();
            if t.is_empty() {
                cur.title.as_str()
            } else {
                t
            }
        }
    };
    let description = match description {
        None => cur.description.as_str(),
        Some(d) => d,
    };

    let module_id = match module_structure_item_id {
        None => cur.module_structure_item_id,
        Some(v) => v,
    };

    sqlx::query_as::<_, LearningOutcomeRow>(&format!(
        r#"
        UPDATE {}
        SET title = $3, description = $4, module_structure_item_id = $5, updated_at = NOW()
        WHERE id = $1 AND course_id = $2
        RETURNING id, course_id, title, description, sort_order, module_structure_item_id, created_at, updated_at
        "#,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(outcome_id)
    .bind(course_id)
    .bind(title)
    .bind(description)
    .bind(module_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_outcome(
    pool: &PgPool,
    course_id: Uuid,
    outcome_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $1 AND course_id = $2"#,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(outcome_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn insert_link(
    pool: &PgPool,
    outcome_id: Uuid,
    sub_outcome_id: Option<Uuid>,
    structure_item_id: Uuid,
    target_kind: &str,
    quiz_question_id: &str,
    measurement_level: &str,
    intensity_level: &str,
) -> Result<OutcomeLinkRow, sqlx::Error> {
    sqlx::query_as::<_, OutcomeLinkRow>(&format!(
        r#"
        INSERT INTO {} (outcome_id, sub_outcome_id, structure_item_id, target_kind, quiz_question_id, measurement_level, intensity_level)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, outcome_id, sub_outcome_id, structure_item_id, target_kind, quiz_question_id, measurement_level, intensity_level, created_at
        "#,
        schema::COURSE_OUTCOME_LINKS
    ))
    .bind(outcome_id)
    .bind(sub_outcome_id)
    .bind(structure_item_id)
    .bind(target_kind)
    .bind(quiz_question_id)
    .bind(measurement_level)
    .bind(intensity_level)
    .fetch_one(pool)
    .await
}

pub async fn delete_link(
    pool: &PgPool,
    course_id: Uuid,
    outcome_id: Uuid,
    link_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        DELETE FROM {} l
        USING {} o
        WHERE l.id = $1 AND l.outcome_id = $2 AND l.outcome_id = o.id AND o.course_id = $3
        "#,
        schema::COURSE_OUTCOME_LINKS,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(link_id)
    .bind(outcome_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn insert_sub_outcome(
    pool: &PgPool,
    course_id: Uuid,
    outcome_id: Uuid,
    title: &str,
    description: &str,
) -> Result<OutcomeSubOutcomeRow, sqlx::Error> {
    let ok: bool = sqlx::query_scalar(&format!(
        r#"SELECT EXISTS(SELECT 1 FROM {} o WHERE o.id = $1 AND o.course_id = $2)"#,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(outcome_id)
    .bind(course_id)
    .fetch_one(pool)
    .await?;
    if !ok {
        return Err(sqlx::Error::RowNotFound);
    }

    let next_sort: i32 = sqlx::query_scalar(&format!(
        r#"SELECT COALESCE(MAX(sort_order), -1) + 1 FROM {} WHERE outcome_id = $1"#,
        schema::COURSE_OUTCOME_SUB_OUTCOMES
    ))
    .bind(outcome_id)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, OutcomeSubOutcomeRow>(&format!(
        r#"
        INSERT INTO {} (outcome_id, title, description, sort_order)
        VALUES ($1, $2, $3, $4)
        RETURNING id, outcome_id, title, description, sort_order, created_at, updated_at
        "#,
        schema::COURSE_OUTCOME_SUB_OUTCOMES
    ))
    .bind(outcome_id)
    .bind(title)
    .bind(description)
    .bind(next_sort)
    .fetch_one(pool)
    .await
}

pub async fn sub_outcome_owned_by_outcome_in_course(
    pool: &PgPool,
    course_id: Uuid,
    outcome_id: Uuid,
    sub_outcome_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let v: bool = sqlx::query_scalar(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM {} s
            INNER JOIN {} o ON o.id = s.outcome_id
            WHERE s.id = $1 AND s.outcome_id = $2 AND o.course_id = $3
        )
        "#,
        schema::COURSE_OUTCOME_SUB_OUTCOMES,
        schema::COURSE_LEARNING_OUTCOMES
    ))
    .bind(sub_outcome_id)
    .bind(outcome_id)
    .bind(course_id)
    .fetch_one(pool)
    .await?;
    Ok(v)
}

pub async fn list_whole_item_links_for_outcome(
    pool: &PgPool,
    course_id: Uuid,
    outcome_id: Uuid,
) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as::<_, (Uuid, String)>(&format!(
        r#"
        SELECT DISTINCT l.structure_item_id, s.kind
        FROM {} l
        INNER JOIN {} o ON o.id = l.outcome_id
        INNER JOIN {} s ON s.id = l.structure_item_id
        WHERE o.course_id = $1 AND o.id = $2
          AND l.target_kind IN ('assignment', 'quiz')
        "#,
        schema::COURSE_OUTCOME_LINKS,
        schema::COURSE_LEARNING_OUTCOMES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(outcome_id)
    .fetch_all(pool)
    .await
}

async fn assignment_points_possible(pool: &PgPool, item_id: Uuid) -> Result<f64, sqlx::Error> {
    let v: Option<i32> = sqlx::query_scalar(&format!(
        r#"SELECT points_worth FROM {} WHERE structure_item_id = $1"#,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(item_id)
    .fetch_optional(pool)
    .await?;
    Ok(v.filter(|p| *p > 0).map(|p| p as f64).unwrap_or(0.0))
}

async fn quiz_points_possible(pool: &PgPool, item_id: Uuid) -> Result<f64, sqlx::Error> {
    let v: Option<i32> = sqlx::query_scalar(&format!(
        r#"SELECT points_worth FROM {} WHERE structure_item_id = $1"#,
        schema::MODULE_QUIZZES
    ))
    .bind(item_id)
    .fetch_optional(pool)
    .await?;
    Ok(v.filter(|p| *p > 0).map(|p| p as f64).unwrap_or(0.0))
}

/// Progress from `course_grades` for a whole assignment or quiz item.
pub async fn progress_for_graded_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    item_kind: &str,
    enrolled_learners: i32,
) -> Result<OutcomeLinkProgress, sqlx::Error> {
    let possible = match item_kind {
        "assignment" => assignment_points_possible(pool, item_id).await?,
        "quiz" => quiz_points_possible(pool, item_id).await?,
        _ => 0.0,
    };

    let rows: Vec<(Uuid, f64)> = sqlx::query_as(&format!(
        r#"
        SELECT student_user_id, points_earned
        FROM {}
        WHERE course_id = $1 AND module_item_id = $2
        "#,
        schema::COURSE_GRADES
    ))
    .bind(course_id)
    .bind(item_id)
    .fetch_all(pool)
    .await?;

    let graded = rows.len() as i32;
    if possible <= 0.0 || graded == 0 {
        return Ok(OutcomeLinkProgress {
            avg_score_percent: None,
            graded_learners: graded,
            enrolled_learners,
        });
    }

    let mut sum_pct = 0.0_f64;
    for (_, earned) in rows {
        let pct = (earned / possible).clamp(0.0, 1.0) * 100.0;
        if pct.is_finite() {
            sum_pct += pct;
        }
    }
    let avg = (sum_pct / graded as f64) as f32;

    Ok(OutcomeLinkProgress {
        avg_score_percent: Some(avg),
        graded_learners: graded,
        enrolled_learners,
    })
}

/// Latest submitted attempt per learner; average score ratio on one question (`quiz_responses.question_id`).
pub async fn progress_for_quiz_question(
    pool: &PgPool,
    course_id: Uuid,
    quiz_item_id: Uuid,
    question_id: &str,
    enrolled_learners: i32,
) -> Result<OutcomeLinkProgress, sqlx::Error> {
    let rows: Vec<(Option<f64>,)> = sqlx::query_as(&format!(
        r#"
        WITH latest AS (
            SELECT DISTINCT ON (student_user_id)
                id
            FROM {}
            WHERE course_id = $1
              AND structure_item_id = $2
              AND status = 'submitted'
            ORDER BY student_user_id, submitted_at DESC NULLS LAST, id DESC
        )
        SELECT
            CASE
                WHEN qr.max_points > 0::double precision
                    THEN (COALESCE(qr.points_awarded, 0)::double precision / qr.max_points)
                ELSE NULL
            END AS ratio
        FROM latest la
        INNER JOIN {} qr ON qr.attempt_id = la.id
        WHERE qr.question_id = $3
        "#,
        schema::QUIZ_ATTEMPTS,
        schema::QUIZ_RESPONSES
    ))
    .bind(course_id)
    .bind(quiz_item_id)
    .bind(question_id)
    .fetch_all(pool)
    .await?;

    let ratios: Vec<f64> = rows
        .into_iter()
        .filter_map(|(r,)| r.filter(|x| x.is_finite()))
        .collect();

    let graded = ratios.len() as i32;
    if graded == 0 {
        return Ok(OutcomeLinkProgress {
            avg_score_percent: None,
            graded_learners: 0,
            enrolled_learners,
        });
    }

    let sum: f64 = ratios.iter().sum();
    let avg = ((sum / graded as f64) * 100.0) as f32;

    Ok(OutcomeLinkProgress {
        avg_score_percent: Some(avg),
        graded_learners: graded,
        enrolled_learners,
    })
}
