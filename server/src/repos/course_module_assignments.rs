use std::collections::HashMap;
use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use sqlx::PgPool;
use sqlx::Postgres;
use sqlx::Transaction;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone)]
pub struct CourseItemAssignmentRow {
    pub title: String,
    pub markdown: String,
    pub due_at: Option<DateTime<Utc>>,
    pub points_worth: Option<i32>,
    pub assignment_group_id: Option<Uuid>,
    pub updated_at: DateTime<Utc>,
    pub available_from: Option<DateTime<Utc>>,
    pub available_until: Option<DateTime<Utc>>,
    pub assignment_access_code: Option<String>,
    pub submission_allow_text: bool,
    pub submission_allow_file_upload: bool,
    pub submission_allow_url: bool,
    pub late_submission_policy: String,
    pub late_penalty_percent: Option<i32>,
    pub rubric_json: Option<JsonValue>,
    pub blind_grading: bool,
    pub identities_revealed_at: Option<DateTime<Utc>>,
    pub moderated_grading: bool,
    pub moderation_threshold_pct: i32,
    pub moderator_user_id: Option<Uuid>,
    pub provisional_grader_user_ids: Vec<Uuid>,
    /// `disabled` | `plagiarism` | `ai` | `both`
    pub originality_detection: String,
    /// `show` | `hide` | `show_after_grading`
    pub originality_student_visibility: String,
    /// When set, overrides the course grading scheme display for this assignment.
    pub grading_type: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AssignmentBodyWrite {
    pub markdown: String,
    pub points_worth: Option<i32>,
    pub available_from: Option<DateTime<Utc>>,
    pub available_until: Option<DateTime<Utc>>,
    /// `None` stores SQL NULL (no access code).
    pub assignment_access_code: Option<String>,
    pub submission_allow_text: bool,
    pub submission_allow_file_upload: bool,
    pub submission_allow_url: bool,
    pub late_submission_policy: String,
    pub late_penalty_percent: Option<i32>,
    pub rubric_json: Option<JsonValue>,
    pub blind_grading: bool,
    pub identities_revealed_at: Option<DateTime<Utc>>,
    pub moderated_grading: bool,
    pub moderation_threshold_pct: i32,
    pub moderator_user_id: Option<Uuid>,
    pub provisional_grader_user_ids: Vec<Uuid>,
    pub originality_detection: String,
    pub originality_student_visibility: String,
    pub grading_type: Option<String>,
}

pub async fn insert_empty_for_item(
    tx: &mut Transaction<'_, Postgres>,
    structure_item_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, markdown, updated_at)
        VALUES ($1, '', NOW())
        "#,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(structure_item_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

/// `points_worth` from `module_assignments` for structure outline rows.
pub async fn points_worth_for_structure_items(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_ids: &[Uuid],
) -> Result<HashMap<Uuid, Option<i32>>, sqlx::Error> {
    if structure_item_ids.is_empty() {
        return Ok(HashMap::new());
    }
    #[derive(Debug, Clone, FromRow)]
    struct Row {
        id: Uuid,
        points_worth: Option<i32>,
    }
    let rows: Vec<Row> = sqlx::query_as(&format!(
        r#"
        SELECT c.id, m.points_worth
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.course_id = $1 AND c.kind = 'assignment' AND c.id = ANY($2)
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(course_id)
    .bind(structure_item_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| (r.id, r.points_worth)).collect())
}

/// `rubric_json` from `module_assignments` for assignment structure items (batch).
pub async fn rubrics_for_structure_items(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_ids: &[Uuid],
) -> Result<HashMap<Uuid, Option<JsonValue>>, sqlx::Error> {
    if structure_item_ids.is_empty() {
        return Ok(HashMap::new());
    }
    #[derive(Debug, Clone, FromRow)]
    struct Row {
        id: Uuid,
        rubric_json: Option<JsonValue>,
    }
    let rows: Vec<Row> = sqlx::query_as(&format!(
        r#"
        SELECT c.id, m.rubric_json
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.course_id = $1 AND c.kind = 'assignment' AND c.id = ANY($2)
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(course_id)
    .bind(structure_item_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| (r.id, r.rubric_json)).collect())
}

/// `grading_type` override for assignments (batch).
pub async fn grading_types_for_structure_items(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_ids: &[Uuid],
) -> Result<HashMap<Uuid, Option<String>>, sqlx::Error> {
    if structure_item_ids.is_empty() {
        return Ok(HashMap::new());
    }
    #[derive(Debug, Clone, FromRow)]
    struct Row {
        id: Uuid,
        grading_type: Option<String>,
    }
    let rows: Vec<Row> = sqlx::query_as(&format!(
        r#"
        SELECT c.id, m.grading_type
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.course_id = $1 AND c.kind = 'assignment' AND c.id = ANY($2)
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(course_id)
    .bind(structure_item_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| (r.id, r.grading_type)).collect())
}

#[derive(Debug, Clone, FromRow)]
struct AssignmentJoinRow {
    title: String,
    markdown: String,
    due_at: Option<DateTime<Utc>>,
    points_worth: Option<i32>,
    assignment_group_id: Option<Uuid>,
    updated_at: DateTime<Utc>,
    available_from: Option<DateTime<Utc>>,
    available_until: Option<DateTime<Utc>>,
    assignment_access_code: Option<String>,
    submission_allow_text: bool,
    submission_allow_file_upload: bool,
    submission_allow_url: bool,
    late_submission_policy: String,
    late_penalty_percent: Option<i32>,
    rubric_json: Option<JsonValue>,
    blind_grading: bool,
    identities_revealed_at: Option<DateTime<Utc>>,
    moderated_grading: bool,
    moderation_threshold_pct: i32,
    moderator_user_id: Option<Uuid>,
    provisional_grader_user_ids: Vec<Uuid>,
    originality_detection: String,
    originality_student_visibility: String,
    grading_type: Option<String>,
}

pub async fn get_for_course_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CourseItemAssignmentRow>, sqlx::Error> {
    let row: Option<AssignmentJoinRow> = sqlx::query_as(&format!(
        r#"
        SELECT c.title, m.markdown, c.due_at, m.points_worth, c.assignment_group_id, m.updated_at,
               m.available_from, m.available_until, m.assignment_access_code,
               m.submission_allow_text, m.submission_allow_file_upload, m.submission_allow_url,
               m.late_submission_policy, m.late_penalty_percent, m.rubric_json,
               m.blind_grading, m.identities_revealed_at,
               m.moderated_grading, m.moderation_threshold_pct, m.moderator_user_id,
               m.provisional_grader_user_ids,
               m.originality_detection, m.originality_student_visibility,
               m.grading_type
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_ASSIGNMENTS
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| CourseItemAssignmentRow {
        title: r.title,
        markdown: r.markdown,
        due_at: r.due_at,
        points_worth: r.points_worth,
        assignment_group_id: r.assignment_group_id,
        updated_at: r.updated_at,
        available_from: r.available_from,
        available_until: r.available_until,
        assignment_access_code: r.assignment_access_code,
        submission_allow_text: r.submission_allow_text,
        submission_allow_file_upload: r.submission_allow_file_upload,
        submission_allow_url: r.submission_allow_url,
        late_submission_policy: r.late_submission_policy,
        late_penalty_percent: r.late_penalty_percent,
        rubric_json: r.rubric_json,
        blind_grading: r.blind_grading,
        identities_revealed_at: r.identities_revealed_at,
        moderated_grading: r.moderated_grading,
        moderation_threshold_pct: r.moderation_threshold_pct,
        moderator_user_id: r.moderator_user_id,
        provisional_grader_user_ids: r.provisional_grader_user_ids,
        originality_detection: r.originality_detection,
        originality_student_visibility: r.originality_student_visibility,
        grading_type: r.grading_type,
    }))
}

pub async fn write_assignment_body(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    body: &AssignmentBodyWrite,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET markdown = $3,
            points_worth = $4,
            available_from = $5,
            available_until = $6,
            assignment_access_code = $7,
            submission_allow_text = $8,
            submission_allow_file_upload = $9,
            submission_allow_url = $10,
            late_submission_policy = $11,
            late_penalty_percent = $12,
            rubric_json = $13,
            blind_grading = $14,
            identities_revealed_at = $15,
            moderated_grading = $16,
            moderation_threshold_pct = $17,
            moderator_user_id = $18,
            provisional_grader_user_ids = $19,
            originality_detection = $20,
            originality_student_visibility = $21,
            grading_type = $22,
            settings_version = m.settings_version + 1,
            updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'assignment'
        RETURNING m.updated_at
        "#,
        schema::MODULE_ASSIGNMENTS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(&body.markdown)
    .bind(body.points_worth)
    .bind(body.available_from)
    .bind(body.available_until)
    .bind(body.assignment_access_code.as_deref())
    .bind(body.submission_allow_text)
    .bind(body.submission_allow_file_upload)
    .bind(body.submission_allow_url)
    .bind(&body.late_submission_policy)
    .bind(body.late_penalty_percent)
    .bind(&body.rubric_json)
    .bind(body.blind_grading)
    .bind(body.identities_revealed_at)
    .bind(body.moderated_grading)
    .bind(body.moderation_threshold_pct)
    .bind(body.moderator_user_id)
    .bind(&body.provisional_grader_user_ids)
    .bind(&body.originality_detection)
    .bind(&body.originality_student_visibility)
    .bind(body.grading_type.as_deref())
    .fetch_optional(pool)
    .await
}

/// Sets `identities_revealed_at` and appends a FERPA-significant audit row. Returns the timestamp
/// when the update applied, or `None` if the assignment is not in a blind-active state.
pub async fn reveal_blind_grading_identities(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    revealed_by_user_id: Uuid,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let revealed_at: Option<DateTime<Utc>> = sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET identities_revealed_at = NOW(),
            settings_version = m.settings_version + 1,
            updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'assignment'
          AND m.blind_grading = TRUE
          AND m.identities_revealed_at IS NULL
        RETURNING m.identities_revealed_at
        "#,
        schema::MODULE_ASSIGNMENTS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();

    let Some(at) = revealed_at else {
        tx.rollback().await?;
        return Ok(None);
    };

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, structure_item_id, revealed_by_user_id)
        VALUES ($1, $2, $3)
        "#,
        schema::ASSIGNMENT_BLIND_GRADING_REVEAL_AUDIT
    ))
    .bind(course_id)
    .bind(item_id)
    .bind(revealed_by_user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Some(at))
}

pub async fn upsert_import_body(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
    points_worth: Option<i32>,
    available_from: Option<DateTime<Utc>>,
    available_until: Option<DateTime<Utc>>,
    assignment_access_code: Option<&str>,
    submission_allow_text: bool,
    submission_allow_file_upload: bool,
    submission_allow_url: bool,
    late_submission_policy: &str,
    late_penalty_percent: Option<i32>,
    rubric_json: Option<&JsonValue>,
    originality_detection: &str,
    originality_student_visibility: &str,
    blind_grading: bool,
    grading_type: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} AS m (
            structure_item_id, markdown, points_worth, updated_at,
            available_from, available_until, assignment_access_code,
            submission_allow_text, submission_allow_file_upload, submission_allow_url,
            late_submission_policy, late_penalty_percent, rubric_json,
            originality_detection, originality_student_visibility,
            blind_grading, grading_type, identities_revealed_at
        )
        SELECT c.id, $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NULL
        FROM {} c
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
        ON CONFLICT (structure_item_id) DO UPDATE
        SET markdown = EXCLUDED.markdown,
            points_worth = EXCLUDED.points_worth,
            available_from = EXCLUDED.available_from,
            available_until = EXCLUDED.available_until,
            assignment_access_code = EXCLUDED.assignment_access_code,
            submission_allow_text = EXCLUDED.submission_allow_text,
            submission_allow_file_upload = EXCLUDED.submission_allow_file_upload,
            submission_allow_url = EXCLUDED.submission_allow_url,
            late_submission_policy = EXCLUDED.late_submission_policy,
            late_penalty_percent = EXCLUDED.late_penalty_percent,
            rubric_json = EXCLUDED.rubric_json,
            originality_detection = EXCLUDED.originality_detection,
            originality_student_visibility = EXCLUDED.originality_student_visibility,
            blind_grading = EXCLUDED.blind_grading,
            grading_type = EXCLUDED.grading_type,
            identities_revealed_at = NULL,
            settings_version = m.settings_version + 1,
            updated_at = NOW()
        "#,
        schema::MODULE_ASSIGNMENTS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .bind(points_worth)
    .bind(available_from)
    .bind(available_until)
    .bind(assignment_access_code)
    .bind(submission_allow_text)
    .bind(submission_allow_file_upload)
    .bind(submission_allow_url)
    .bind(late_submission_policy)
    .bind(late_penalty_percent)
    .bind(rubric_json)
    .bind(originality_detection)
    .bind(originality_student_visibility)
    .bind(blind_grading)
    .bind(grading_type)
    .execute(pool)
    .await?;
    Ok(())
}
