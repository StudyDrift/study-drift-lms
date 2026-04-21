//! Persistence for normalized questions, pools, quiz refs, and attempt selections.

use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use sqlx::{Executor, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuestionEntity {
    pub id: Uuid,
    pub course_id: Uuid,
    pub question_type: String,
    pub stem: String,
    pub options: Option<JsonValue>,
    pub correct_answer: Option<JsonValue>,
    pub explanation: Option<String>,
    pub points: f64,
    pub status: String,
    pub shared: bool,
    pub source: String,
    pub metadata: JsonValue,
    pub shuffle_choices_override: Option<bool>,
    pub irt_a: Option<f64>,
    pub irt_b: Option<f64>,
    pub irt_c: Option<f64>,
    pub irt_status: String,
    pub irt_sample_n: i32,
    pub irt_calibrated_at: Option<DateTime<Utc>>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version_number: i32,
    pub is_published: bool,
    pub srs_eligible: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuestionVersionSummary {
    pub version_number: i32,
    pub change_note: Option<String>,
    pub change_summary: Option<JsonValue>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AttemptSelectionRow {
    pub question_id: Uuid,
    pub version_number: i32,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuizQuestionRefRow {
    pub id: Uuid,
    pub structure_item_id: Uuid,
    pub question_id: Option<Uuid>,
    pub pool_id: Option<Uuid>,
    pub sample_n: Option<i32>,
    pub position: i16,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuestionPoolEntity {
    pub id: Uuid,
    pub course_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn course_has_question_bank(pool: &PgPool, course_id: Uuid) -> Result<bool, sqlx::Error> {
    let v: Option<bool> = sqlx::query_scalar(&format!(
        r#"SELECT question_bank_enabled FROM {} WHERE id = $1"#,
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(pool)
    .await?;
    Ok(v.unwrap_or(false))
}

pub async fn delete_quiz_question_refs_for_item(
    tx: &mut Transaction<'_, Postgres>,
    structure_item_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE structure_item_id = $1"#,
        schema::QUIZ_QUESTION_REFS
    ))
    .bind(structure_item_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn insert_quiz_question_ref(
    tx: &mut Transaction<'_, Postgres>,
    structure_item_id: Uuid,
    question_id: Option<Uuid>,
    pool_id: Option<Uuid>,
    sample_n: Option<i32>,
    position: i16,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, question_id, pool_id, sample_n, position)
        VALUES ($1, $2, $3, $4, $5)
        "#,
        schema::QUIZ_QUESTION_REFS
    ))
    .bind(structure_item_id)
    .bind(question_id)
    .bind(pool_id)
    .bind(sample_n)
    .bind(position)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn list_quiz_question_refs(
    pool: &PgPool,
    structure_item_id: Uuid,
) -> Result<Vec<QuizQuestionRefRow>, sqlx::Error> {
    sqlx::query_as::<_, QuizQuestionRefRow>(&format!(
        r#"
        SELECT id, structure_item_id, question_id, pool_id, sample_n, position
        FROM {}
        WHERE structure_item_id = $1
        ORDER BY position ASC, id ASC
        "#,
        schema::QUIZ_QUESTION_REFS
    ))
    .bind(structure_item_id)
    .fetch_all(pool)
    .await
}

pub async fn find_legacy_question_id<'e, E>(
    ex: E,
    course_id: Uuid,
    structure_item_id: Uuid,
    legacy_editor_question_id: &str,
) -> Result<Option<Uuid>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let sid = structure_item_id.to_string();
    sqlx::query_scalar(&format!(
        r#"
        SELECT id FROM {}
        WHERE course_id = $1
          AND source = 'legacy_json'
          AND metadata->>'legacyQuizStructureItemId' = $2
          AND metadata->>'legacyEditorQuestionId' = $3
        LIMIT 1
        "#,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .bind(&sid)
    .bind(legacy_editor_question_id)
    .fetch_optional(ex)
    .await
}

pub async fn insert_question(
    tx: &mut Transaction<'_, Postgres>,
    course_id: Uuid,
    question_type: &str,
    stem: &str,
    options: Option<&JsonValue>,
    correct_answer: Option<&JsonValue>,
    explanation: Option<&str>,
    points: f64,
    status: &str,
    shared: bool,
    source: &str,
    metadata: &JsonValue,
    created_by: Option<Uuid>,
    shuffle_choices_override: Option<bool>,
    srs_eligible: bool,
) -> Result<Uuid, sqlx::Error> {
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (
            course_id, question_type, stem, options, correct_answer, explanation,
            points, status, shared, source, metadata, created_by, is_published,
            shuffle_choices_override, srs_eligible
        )
        VALUES (
            $1, $2::course.question_type, $3, $4, $5, $6,
            $7, $8::course.question_status, $9, $10, $11, $12, $13, $14, $15
        )
        RETURNING id
        "#,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .bind(question_type)
    .bind(stem)
    .bind(options)
    .bind(correct_answer)
    .bind(explanation)
    .bind(points)
    .bind(status)
    .bind(shared)
    .bind(source)
    .bind(metadata)
    .bind(created_by)
    .bind(status == "active")
    .bind(shuffle_choices_override)
    .bind(srs_eligible)
    .fetch_one(tx.deref_mut())
    .await?;
    Ok(id)
}

pub async fn update_question_row<'e, E>(
    ex: E,
    course_id: Uuid,
    question_id: Uuid,
    question_type: &str,
    stem: &str,
    options: Option<&JsonValue>,
    correct_answer: Option<&JsonValue>,
    explanation: Option<&str>,
    points: f64,
    status: &str,
    shared: bool,
    metadata: &JsonValue,
    srs_eligible: bool,
) -> Result<bool, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let r = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET question_type = $3::course.question_type,
            stem = $4,
            options = $5,
            correct_answer = $6,
            explanation = $7,
            points = $8,
            status = $9::course.question_status,
            shared = $10,
            metadata = $11,
            srs_eligible = $12,
            is_published = CASE WHEN $9::course.question_status = 'active'::course.question_status THEN TRUE ELSE is_published END,
            updated_at = NOW()
        WHERE id = $2 AND course_id = $1
        "#,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .bind(question_id)
    .bind(question_type)
    .bind(stem)
    .bind(options)
    .bind(correct_answer)
    .bind(explanation)
    .bind(points)
    .bind(status)
    .bind(shared)
    .bind(metadata)
    .bind(srs_eligible)
    .execute(ex)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn get_question(
    pool: &PgPool,
    course_id: Uuid,
    question_id: Uuid,
) -> Result<Option<QuestionEntity>, sqlx::Error> {
    sqlx::query_as::<_, QuestionEntity>(&format!(
        r#"
        SELECT id, course_id, question_type::text, stem, options, correct_answer, explanation,
               points::float8, status::text, shared, source, metadata, shuffle_choices_override,
               irt_a::float8, irt_b::float8, irt_c::float8,
               irt_status::text AS irt_status, irt_sample_n, irt_calibrated_at,
               created_by, created_at, updated_at,
               version_number, is_published, srs_eligible
        FROM {}
        WHERE id = $2 AND course_id = $1
        "#,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .bind(question_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_question(pool: &PgPool, course_id: Uuid, question_id: Uuid) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE id = $2 AND course_id = $1"#,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .bind(question_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

#[derive(Debug, Default)]
pub struct QuestionListFilters<'a> {
    pub q: Option<&'a str>,
    pub type_: Option<&'a str>,
    pub concept_id: Option<Uuid>,
    pub difficulty: Option<&'a str>,
    pub status: Option<&'a str>,
    pub limit: i64,
    pub after_created_at: Option<DateTime<Utc>>,
    pub after_id: Option<Uuid>,
}

pub async fn list_questions_filtered(
    pool: &PgPool,
    course_id: Uuid,
    f: QuestionListFilters<'_>,
) -> Result<Vec<QuestionEntity>, sqlx::Error> {
    let q = f.q.unwrap_or("").trim();
    let type_raw = f.type_.map(|s| s.trim()).filter(|s| !s.is_empty());
    let status_raw = f.status.map(|s| s.trim()).filter(|s| !s.is_empty());
    let diff_raw = f.difficulty.map(|s| s.trim()).filter(|s| !s.is_empty());
    let concept_str = f
        .concept_id
        .map(|cid| cid.to_string())
        .unwrap_or_default();

    let rows: Vec<QuestionEntity> = sqlx::query_as(&format!(
        r#"
        SELECT id, course_id, question_type::text, stem, options, correct_answer, explanation,
               points::float8, status::text, shared, source, metadata, shuffle_choices_override,
               irt_a::float8, irt_b::float8, irt_c::float8,
               irt_status::text AS irt_status, irt_sample_n, irt_calibrated_at,
               created_by, created_at, updated_at,
               version_number, is_published, srs_eligible
        FROM {}
        WHERE course_id = $1
          AND ($2::text = '' OR to_tsvector('english', stem) @@ plainto_tsquery('english', $2))
          AND ($3::text IS NULL OR question_type::text = $3)
          AND (
            $4::text = ''
            OR COALESCE(metadata->'conceptIds', '[]'::jsonb) @> jsonb_build_array(to_jsonb($4::text))
          )
          AND ($5::text IS NULL OR metadata->>'difficulty' = $5)
          AND ($6::text IS NULL OR status::text = $6)
          AND (
            $7::timestamptz IS NULL
            OR $8::uuid IS NULL
            OR (created_at, id) < ($7::timestamptz, $8::uuid)
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $9
        "#,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .bind(q)
    .bind(type_raw)
    .bind(concept_str)
    .bind(diff_raw)
    .bind(status_raw)
    .bind(f.after_created_at)
    .bind(f.after_id)
    .bind(f.limit)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn list_active_pool_question_ids<'e, E>(
    ex: E,
    pool_id: Uuid,
    course_id: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query_scalar(&format!(
        r#"
        SELECT q.id
        FROM {} q
        INNER JOIN {} m ON m.question_id = q.id
        INNER JOIN {} p ON p.id = m.pool_id
        WHERE m.pool_id = $1 AND p.course_id = $2
          AND q.status = 'active'::course.question_status
        "#,
        schema::QUESTIONS,
        schema::QUESTION_POOL_MEMBERS,
        schema::QUESTION_POOLS
    ))
    .bind(pool_id)
    .bind(course_id)
    .fetch_all(ex)
    .await
}

/// Active bank items tagged to any of `concept_ids` (question tags or `metadata.conceptIds`), MC/TF only.
pub async fn list_active_diagnostic_question_ids(
    pool: &PgPool,
    course_id: Uuid,
    concept_ids: &[Uuid],
) -> Result<Vec<Uuid>, sqlx::Error> {
    if concept_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_scalar(&format!(
        r#"
        SELECT DISTINCT q.id
        FROM {} q
        WHERE q.course_id = $1
          AND q.status = 'active'::course.question_status
          AND q.question_type::text IN ('mc_single', 'mc_multiple', 'true_false')
          AND (
            EXISTS (
                SELECT 1 FROM {} t
                WHERE t.question_id = q.id AND t.concept_id = ANY($2)
            )
            OR EXISTS (
                SELECT 1
                FROM unnest($2::uuid[]) AS c(concept_id)
                WHERE COALESCE(q.metadata->'conceptIds', '[]'::jsonb)
                    @> jsonb_build_array(to_jsonb(c.concept_id::text))
            )
          )
        "#,
        schema::QUESTIONS,
        schema::CONCEPT_QUESTION_TAGS
    ))
    .bind(course_id)
    .bind(concept_ids)
    .fetch_all(pool)
    .await
}

pub async fn list_question_concepts_in_set(
    pool: &PgPool,
    question_id: Uuid,
    concept_ids: &[Uuid],
) -> Result<Vec<Uuid>, sqlx::Error> {
    if concept_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_scalar(&format!(
        r#"
        SELECT t.concept_id
        FROM {} t
        WHERE t.question_id = $1 AND t.concept_id = ANY($2)
        "#,
        schema::CONCEPT_QUESTION_TAGS
    ))
    .bind(question_id)
    .bind(concept_ids)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuestionConceptTagRow {
    pub question_id: Uuid,
    pub concept_id: Uuid,
}

pub async fn list_concept_tags_for_questions(
    pool: &PgPool,
    question_ids: &[Uuid],
    concept_ids: &[Uuid],
) -> Result<Vec<QuestionConceptTagRow>, sqlx::Error> {
    if question_ids.is_empty() || concept_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as::<_, QuestionConceptTagRow>(&format!(
        r#"
        SELECT question_id, concept_id
        FROM {}
        WHERE question_id = ANY($1) AND concept_id = ANY($2)
        "#,
        schema::CONCEPT_QUESTION_TAGS
    ))
    .bind(question_ids)
    .bind(concept_ids)
    .fetch_all(pool)
    .await
}

pub async fn delete_attempt_selections(
    tx: &mut Transaction<'_, Postgres>,
    attempt_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE attempt_id = $1"#,
        schema::ATTEMPT_OPTION_ORDERS
    ))
    .bind(attempt_id)
    .execute(tx.deref_mut())
    .await?;
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE attempt_id = $1"#,
        schema::ATTEMPT_QUESTION_SELECTIONS
    ))
    .bind(attempt_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn insert_attempt_selection(
    tx: &mut Transaction<'_, Postgres>,
    attempt_id: Uuid,
    question_id: Uuid,
    version_number: i32,
    position: i16,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (attempt_id, question_id, version_number, position)
        VALUES ($1, $2, $3, $4)
        "#,
        schema::ATTEMPT_QUESTION_SELECTIONS
    ))
    .bind(attempt_id)
    .bind(question_id)
    .bind(version_number)
    .bind(position)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn insert_attempt_option_order(
    tx: &mut Transaction<'_, Postgres>,
    attempt_id: Uuid,
    question_id: Uuid,
    option_order: &[i16],
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (attempt_id, question_id, option_order)
        VALUES ($1, $2, $3)
        "#,
        schema::ATTEMPT_OPTION_ORDERS
    ))
    .bind(attempt_id)
    .bind(question_id)
    .bind(option_order)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn list_attempt_option_orders_map(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<std::collections::HashMap<Uuid, Vec<i16>>, sqlx::Error> {
    use std::collections::HashMap;
    let rows: Vec<(Uuid, Vec<i16>)> = sqlx::query_as(&format!(
        r#"
        SELECT question_id, option_order FROM {}
        WHERE attempt_id = $1
        "#,
        schema::ATTEMPT_OPTION_ORDERS
    ))
    .bind(attempt_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect::<HashMap<_, _>>())
}

pub async fn list_attempt_selections_ordered(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Vec<AttemptSelectionRow>, sqlx::Error> {
    sqlx::query_as::<_, AttemptSelectionRow>(&format!(
        r#"
        SELECT question_id, version_number FROM {}
        WHERE attempt_id = $1
        ORDER BY position ASC
        "#,
        schema::ATTEMPT_QUESTION_SELECTIONS
    ))
    .bind(attempt_id)
    .fetch_all(pool)
    .await
}

pub async fn list_question_versions(
    pool: &PgPool,
    course_id: Uuid,
    question_id: Uuid,
) -> Result<Vec<QuestionVersionSummary>, sqlx::Error> {
    sqlx::query_as::<_, QuestionVersionSummary>(&format!(
        r#"
        SELECT qv.version_number, qv.change_note, qv.change_summary, qv.created_by, qv.created_at
        FROM {} qv
        INNER JOIN {} q ON q.id = qv.question_id
        WHERE qv.question_id = $1 AND q.course_id = $2
        ORDER BY qv.version_number DESC
        "#,
        schema::QUESTION_VERSIONS,
        schema::QUESTIONS
    ))
    .bind(question_id)
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn get_question_version_snapshot(
    pool: &PgPool,
    course_id: Uuid,
    question_id: Uuid,
    version_number: i32,
) -> Result<Option<JsonValue>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT qv.snapshot
        FROM {} qv
        INNER JOIN {} q ON q.id = qv.question_id
        WHERE qv.question_id = $1 AND q.course_id = $2 AND qv.version_number = $3
        "#,
        schema::QUESTION_VERSIONS,
        schema::QUESTIONS
    ))
    .bind(question_id)
    .bind(course_id)
    .bind(version_number)
    .fetch_optional(pool)
    .await
}

pub async fn insert_question_version_snapshot<'e, E>(
    ex: E,
    question: &QuestionEntity,
    change_note: Option<&str>,
    change_summary: Option<&JsonValue>,
    created_by: Option<Uuid>,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let snapshot = serde_json::json!({
        "id": question.id,
        "course_id": question.course_id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": question.options,
        "correct_answer": question.correct_answer,
        "explanation": question.explanation,
        "points": question.points,
        "status": question.status,
        "shared": question.shared,
        "source": question.source,
        "metadata": question.metadata,
        "shuffle_choices_override": question.shuffle_choices_override,
        "irt_a": question.irt_a,
        "irt_b": question.irt_b,
        "irt_c": question.irt_c,
        "irt_status": question.irt_status,
        "irt_sample_n": question.irt_sample_n,
        "irt_calibrated_at": question.irt_calibrated_at,
        "created_by": question.created_by,
        "created_at": question.created_at,
        "updated_at": question.updated_at,
        "version_number": question.version_number,
        "is_published": question.is_published,
        "srs_eligible": question.srs_eligible
    });
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (question_id, version_number, snapshot, change_note, change_summary, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (question_id, version_number) DO NOTHING
        "#,
        schema::QUESTION_VERSIONS
    ))
    .bind(question.id)
    .bind(question.version_number)
    .bind(snapshot)
    .bind(change_note)
    .bind(change_summary)
    .bind(created_by)
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn update_question_row_with_versioning<'e, E>(
    ex: E,
    current: &QuestionEntity,
    question_type: &str,
    stem: &str,
    options: Option<&JsonValue>,
    correct_answer: Option<&JsonValue>,
    explanation: Option<&str>,
    points: f64,
    status: &str,
    shared: bool,
    metadata: &JsonValue,
    shuffle_choices_override: Option<bool>,
    srs_eligible: bool,
) -> Result<i32, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let is_effectively_published = current.is_published || current.status == "active";
    let tracked_changed = current.stem != stem
        || current.options.as_ref() != options
        || current.correct_answer.as_ref() != correct_answer
        || current.explanation.as_deref() != explanation
        || (current.points - points).abs() > f64::EPSILON
        || current.srs_eligible != srs_eligible;
    let new_version = if is_effectively_published && tracked_changed {
        current.version_number + 1
    } else {
        current.version_number
    };
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET question_type = $2::course.question_type,
            stem = $3,
            options = $4,
            correct_answer = $5,
            explanation = $6,
            points = $7,
            status = $8::course.question_status,
            shared = $9,
            metadata = $10,
            version_number = $11,
            shuffle_choices_override = $12,
            srs_eligible = $13,
            is_published = CASE WHEN $8::course.question_status = 'active'::course.question_status THEN TRUE ELSE is_published END,
            updated_at = NOW()
        WHERE id = $1
        "#,
        schema::QUESTIONS
    ))
    .bind(current.id)
    .bind(question_type)
    .bind(stem)
    .bind(options)
    .bind(correct_answer)
    .bind(explanation)
    .bind(points)
    .bind(status)
    .bind(shared)
    .bind(metadata)
    .bind(new_version)
    .bind(shuffle_choices_override)
    .bind(srs_eligible)
    .execute(ex)
    .await?;
    Ok(new_version)
}

pub async fn count_attempt_selections(pool: &PgPool, attempt_id: Uuid) -> Result<i64, sqlx::Error> {
    let (n,): (i64,) = sqlx::query_as(&format!(
        r#"SELECT COUNT(*)::bigint FROM {} WHERE attempt_id = $1"#,
        schema::ATTEMPT_QUESTION_SELECTIONS
    ))
    .bind(attempt_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn insert_pool(
    pool: &PgPool,
    course_id: Uuid,
    name: &str,
    description: Option<&str>,
) -> Result<QuestionPoolEntity, sqlx::Error> {
    sqlx::query_as::<_, QuestionPoolEntity>(&format!(
        r#"
        INSERT INTO {} (course_id, name, description)
        VALUES ($1, $2, $3)
        RETURNING id, course_id, name, description, created_at
        "#,
        schema::QUESTION_POOLS
    ))
    .bind(course_id)
    .bind(name)
    .bind(description)
    .fetch_one(pool)
    .await
}

pub async fn list_pools(pool: &PgPool, course_id: Uuid) -> Result<Vec<QuestionPoolEntity>, sqlx::Error> {
    sqlx::query_as::<_, QuestionPoolEntity>(&format!(
        r#"
        SELECT id, course_id, name, description, created_at
        FROM {}
        WHERE course_id = $1
        ORDER BY name ASC
        "#,
        schema::QUESTION_POOLS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn get_pool(
    pool: &PgPool,
    course_id: Uuid,
    pool_id: Uuid,
) -> Result<Option<QuestionPoolEntity>, sqlx::Error> {
    sqlx::query_as::<_, QuestionPoolEntity>(&format!(
        r#"
        SELECT id, course_id, name, description, created_at
        FROM {}
        WHERE id = $2 AND course_id = $1
        "#,
        schema::QUESTION_POOLS
    ))
    .bind(course_id)
    .bind(pool_id)
    .fetch_optional(pool)
    .await
}

pub async fn add_pool_member(
    pool: &PgPool,
    pool_id: Uuid,
    course_id: Uuid,
    question_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        INSERT INTO {} (pool_id, question_id)
        SELECT $1, $2
        FROM {} p
        INNER JOIN {} q ON q.id = $2 AND q.course_id = p.course_id
        WHERE p.id = $1 AND p.course_id = $3
        ON CONFLICT DO NOTHING
        "#,
        schema::QUESTION_POOL_MEMBERS,
        schema::QUESTION_POOLS,
        schema::QUESTIONS
    ))
    .bind(pool_id)
    .bind(question_id)
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn remove_pool_member(
    pool: &PgPool,
    pool_id: Uuid,
    course_id: Uuid,
    question_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        DELETE FROM {} m
        USING {} p
        WHERE m.pool_id = p.id AND m.pool_id = $1 AND p.course_id = $2 AND m.question_id = $3
        "#,
        schema::QUESTION_POOL_MEMBERS,
        schema::QUESTION_POOLS
    ))
    .bind(pool_id)
    .bind(course_id)
    .bind(question_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_question_bank_for_course(
    tx: &mut Transaction<'_, Postgres>,
    course_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::QUESTION_POOLS
    ))
    .bind(course_id)
    .execute(tx.deref_mut())
    .await?;
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn count_scored_responses_for_question(
    pool: &PgPool,
    course_id: Uuid,
    question_id: Uuid,
) -> Result<i64, sqlx::Error> {
    let qid = question_id.to_string();
    let (n,): (i64,) = sqlx::query_as(&format!(
        r#"
        SELECT COUNT(*)::bigint
        FROM {} r
        INNER JOIN {} a ON a.id = r.attempt_id
        WHERE a.course_id = $1
          AND r.question_id = $2
          AND r.is_correct IS NOT NULL
        "#,
        schema::QUIZ_RESPONSES,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(qid)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn list_binary_responses_for_question(
    pool: &PgPool,
    course_id: Uuid,
    question_id: Uuid,
) -> Result<Vec<u8>, sqlx::Error> {
    let qid = question_id.to_string();
    let rows: Vec<(bool,)> = sqlx::query_as(&format!(
        r#"
        SELECT r.is_correct
        FROM {} r
        INNER JOIN {} a ON a.id = r.attempt_id
        WHERE a.course_id = $1
          AND r.question_id = $2
          AND r.is_correct IS NOT NULL
        ORDER BY r.id ASC
        LIMIT 100000
        "#,
        schema::QUIZ_RESPONSES,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(course_id)
    .bind(qid)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(ok,)| if ok { 1_u8 } else { 0_u8 }).collect())
}

pub async fn update_question_irt_fitted(
    pool: &PgPool,
    course_id: Uuid,
    question_id: Uuid,
    irt_a: f64,
    irt_b: f64,
    sample_n: i32,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET irt_a = $3,
            irt_b = $4,
            irt_sample_n = $5,
            irt_status = 'calibrated'::course.irt_calibration_status,
            irt_calibrated_at = NOW(),
            updated_at = NOW()
        WHERE id = $2 AND course_id = $1
        "#,
        schema::QUESTIONS
    ))
    .bind(course_id)
    .bind(question_id)
    .bind(irt_a)
    .bind(irt_b)
    .bind(sample_n)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}
