use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::types::Json;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_module_survey::{SurveyQuestion, SurveyQuestionResult, SurveyResponse};

#[derive(Debug, Clone, FromRow)]
pub struct CourseItemSurveyRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub title: String,
    pub description: String,
    pub anonymity_mode: String,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
    pub questions_json: Json<Vec<SurveyQuestion>>,
    pub updated_at: DateTime<Utc>,
}

pub async fn insert_empty_for_item(
    tx: &mut Transaction<'_, Postgres>,
    structure_item_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        "INSERT INTO {} (structure_item_id, description, anonymity_mode, questions_json, updated_at)
         VALUES ($1, '', 'identified', '[]'::jsonb, NOW())",
        schema::MODULE_SURVEYS
    ))
    .bind(structure_item_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn list_for_course(pool: &PgPool, course_id: Uuid) -> Result<Vec<SurveyResponse>, sqlx::Error> {
    let rows: Vec<CourseItemSurveyRow> = sqlx::query_as(&format!(
        r#"
        SELECT c.id, c.course_id, c.title, s.description, s.anonymity_mode::text AS anonymity_mode,
               s.opens_at, s.closes_at, s.questions_json, s.updated_at
        FROM {} c
        INNER JOIN {} s ON s.structure_item_id = c.id
        WHERE c.course_id = $1 AND c.kind = 'survey'
        ORDER BY c.sort_order, c.created_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_SURVEYS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(map_row).collect())
}

pub async fn get_for_item(pool: &PgPool, item_id: Uuid) -> Result<Option<SurveyResponse>, sqlx::Error> {
    let row: Option<CourseItemSurveyRow> = sqlx::query_as(&format!(
        r#"
        SELECT c.id, c.course_id, c.title, s.description, s.anonymity_mode::text AS anonymity_mode,
               s.opens_at, s.closes_at, s.questions_json, s.updated_at
        FROM {} c
        INNER JOIN {} s ON s.structure_item_id = c.id
        WHERE c.id = $1 AND c.kind = 'survey'
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_SURVEYS
    ))
    .bind(item_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(map_row))
}

pub async fn update_survey(
    pool: &PgPool,
    item_id: Uuid,
    title: Option<&str>,
    description: Option<&str>,
    anonymity_mode: Option<&str>,
    opens_at: Option<DateTime<Utc>>,
    closes_at: Option<DateTime<Utc>>,
    questions: Option<&[SurveyQuestion]>,
) -> Result<Option<SurveyResponse>, sqlx::Error> {
    if let Some(t) = title {
        sqlx::query(&format!(
            "UPDATE {} SET title = $2, updated_at = NOW() WHERE id = $1 AND kind = 'survey'",
            schema::COURSE_STRUCTURE_ITEMS
        ))
        .bind(item_id)
        .bind(t)
        .execute(pool)
        .await?;
    }

    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET description = COALESCE($2, description),
            anonymity_mode = COALESCE($3::course.survey_anonymity, anonymity_mode),
            opens_at = COALESCE($4, opens_at),
            closes_at = COALESCE($5, closes_at),
            questions_json = COALESCE($6, questions_json),
            updated_at = NOW()
        WHERE structure_item_id = $1
        "#,
        schema::MODULE_SURVEYS
    ))
    .bind(item_id)
    .bind(description)
    .bind(anonymity_mode)
    .bind(opens_at)
    .bind(closes_at)
    .bind(questions.map(|q| Json(q.to_vec())))
    .execute(pool)
    .await?;

    get_for_item(pool, item_id).await
}

pub fn submission_hash(user_id: Uuid, survey_item_id: Uuid) -> String {
    let mut h = Sha256::new();
    h.update(user_id.as_bytes());
    h.update(survey_item_id.as_bytes());
    format!("{:x}", h.finalize())
}

pub async fn submit_response(
    pool: &PgPool,
    item_id: Uuid,
    user_id: Uuid,
    answers: &Value,
) -> Result<(bool, bool), sqlx::Error> {
    let row: Option<(String, Option<DateTime<Utc>>, Option<DateTime<Utc>>)> = sqlx::query_as(&format!(
        "SELECT anonymity_mode::text, opens_at, closes_at FROM {} WHERE structure_item_id = $1",
        schema::MODULE_SURVEYS
    ))
    .bind(item_id)
    .fetch_optional(pool)
    .await?;
    let Some((mode, opens_at, closes_at)) = row else {
        return Ok((false, false));
    };
    let now = Utc::now();
    if opens_at.is_some_and(|t| now < t) || closes_at.is_some_and(|t| now > t) {
        return Ok((false, false));
    }
    let hash = submission_hash(user_id, item_id);
    let stored_user_id = if mode == "anonymous" { None } else { Some(user_id) };
    let inserted = sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, user_id, submission_hash, answers_json)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (structure_item_id, submission_hash) DO NOTHING
        "#,
        schema::MODULE_SURVEY_RESPONSES
    ))
    .bind(item_id)
    .bind(stored_user_id)
    .bind(hash)
    .bind(answers)
    .execute(pool)
    .await?
    .rows_affected()
        > 0;
    Ok((true, !inserted))
}

pub async fn aggregate_results(
    pool: &PgPool,
    item_id: Uuid,
) -> Result<(i64, Vec<SurveyQuestionResult>), sqlx::Error> {
    let Some(survey) = get_for_item(pool, item_id).await? else {
        return Ok((0, Vec::new()));
    };
    let responses: Vec<Value> = sqlx::query_scalar(&format!(
        "SELECT answers_json FROM {} WHERE structure_item_id = $1",
        schema::MODULE_SURVEY_RESPONSES
    ))
    .bind(item_id)
    .fetch_all(pool)
    .await?;
    let mut out = Vec::with_capacity(survey.questions.len());
    for q in &survey.questions {
        let mut count = 0_i64;
        let mut numeric_sum = 0_f64;
        let mut numeric_count = 0_i64;
        let mut dist: Map<String, Value> = Map::new();
        for a in &responses {
            let Some(v) = a.get(&q.id) else {
                continue;
            };
            count += 1;
            if let Some(n) = v.as_f64() {
                numeric_sum += n;
                numeric_count += 1;
                let key = format!("{}", n as i64);
                let next = dist.get(&key).and_then(|x| x.as_i64()).unwrap_or(0) + 1;
                dist.insert(key, json!(next));
                continue;
            }
            if let Some(s) = v.as_str() {
                let next = dist.get(s).and_then(|x| x.as_i64()).unwrap_or(0) + 1;
                dist.insert(s.to_string(), json!(next));
                continue;
            }
        }
        out.push(SurveyQuestionResult {
            question_id: q.id.clone(),
            subtype: q.subtype.clone(),
            response_count: count,
            mean: (numeric_count > 0).then_some(numeric_sum / numeric_count as f64),
            distribution: Value::Object(dist),
        });
    }
    Ok((responses.len() as i64, out))
}

fn map_row(row: CourseItemSurveyRow) -> SurveyResponse {
    SurveyResponse {
        id: row.id,
        course_id: row.course_id,
        title: row.title,
        description: row.description,
        anonymity_mode: row.anonymity_mode,
        opens_at: row.opens_at,
        closes_at: row.closes_at,
        questions: row.questions_json.0,
        updated_at: row.updated_at,
    }
}
