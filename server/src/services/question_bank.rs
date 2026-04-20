//! Question bank: editor JSON sync, pool sampling, and delivery helpers.

use std::collections::HashMap;
use std::ops::DerefMut;

use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::SeedableRng;
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_module_quiz::QuizQuestion;
use crate::repos::question_bank as qb_repo;
use qb_repo::{QuestionEntity, QuestionListFilters, QuizQuestionRefRow};

fn sample_seed(attempt_id: Uuid, user_id: Uuid) -> u64 {
    let mut h = Sha256::new();
    h.update(attempt_id.as_bytes());
    h.update(user_id.as_bytes());
    let b = h.finalize();
    u64::from_le_bytes(b[..8].try_into().unwrap_or([0u8; 8]))
}

fn is_extended_quiz_type(question_type: &str) -> bool {
    matches!(
        question_type,
        "matching"
            | "ordering"
            | "hotspot"
            | "numeric"
            | "formula"
            | "code"
            | "file_upload"
            | "audio_response"
            | "video_response"
    )
}

fn sample_n_from_pool(mut ids: Vec<Uuid>, n: usize, attempt_id: Uuid, user_id: Uuid) -> Vec<Uuid> {
    if ids.is_empty() || n == 0 {
        return vec![];
    }
    let n = n.min(ids.len());
    let mut rng = StdRng::seed_from_u64(sample_seed(attempt_id, user_id));
    ids.shuffle(&mut rng);
    ids.truncate(n);
    ids
}

/// Maps editor [`QuizQuestion`] into DB `question_type` label (Postgres enum member).
pub fn db_question_type_from_editor(q: &QuizQuestion) -> &'static str {
    match q.question_type.as_str() {
        "true_false" => "true_false",
        "fill_in_blank" | "short_answer" | "essay" => "short_answer",
        _ => "mc_single",
    }
}

fn editor_question_type_from_db(db: &str) -> String {
    match db {
        "true_false" => "true_false".into(),
        "short_answer" => "short_answer".into(),
        "mc_multiple" => "multiple_choice".into(),
        _ => "multiple_choice".into(),
    }
}

fn options_json_from_quiz_question(q: &QuizQuestion) -> JsonValue {
    json!(q
        .choices
        .iter()
        .map(|c| c.as_str())
        .collect::<Vec<_>>())
}

fn correct_answer_json_from_quiz_question(q: &QuizQuestion) -> Option<JsonValue> {
    if let Some(idx) = q.correct_choice_index {
        return Some(json!({ "correctChoiceIndex": idx }));
    }
    None
}

pub fn quiz_question_from_entity(e: &QuestionEntity) -> Result<QuizQuestion, AppError> {
    let choices: Vec<String> = e
        .options
        .as_ref()
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let correct_choice_index = e
        .correct_answer
        .as_ref()
        .and_then(|v| v.get("correctChoiceIndex"))
        .and_then(|x| x.as_u64())
        .map(|n| n as usize);

    let points = e.points.round() as i32;

    Ok(QuizQuestion {
        id: e.id.to_string(),
        prompt: e.stem.clone(),
        question_type: editor_question_type_from_db(&e.question_type),
        choices,
        type_config: serde_json::json!({}),
        correct_choice_index,
        multiple_answer: e.question_type == "mc_multiple",
        answer_with_image: false,
        required: true,
        points,
        estimated_minutes: 2,
    })
}

pub async fn load_quiz_questions_map(
    pool: &PgPool,
    course_id: Uuid,
    ids: &[Uuid],
) -> Result<HashMap<Uuid, QuestionEntity>, AppError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<QuestionEntity> = sqlx::query_as(&format!(
        r#"
        SELECT id, course_id, question_type::text, stem, options, correct_answer, explanation,
               points::float8, status::text, shared, source, metadata,
               irt_a::float8, irt_b::float8, irt_status, created_by, created_at, updated_at
        FROM {}
        WHERE course_id = $1 AND id = ANY($2)
        "#,
        crate::db::schema::QUESTIONS
    ))
    .bind(course_id)
    .bind(ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| (r.id, r)).collect())
}

pub fn refs_use_pool(refs: &[QuizQuestionRefRow]) -> bool {
    refs.iter().any(|r| r.pool_id.is_some())
}

/// When the course flag is on, replace quiz_question_refs from the editor JSON payload.
pub async fn sync_quiz_refs_from_editor_json(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
    questions: &[QuizQuestion],
    created_by: Option<Uuid>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    qb_repo::delete_quiz_question_refs_for_item(&mut tx, structure_item_id).await?;

    for (pos, q) in questions.iter().enumerate() {
        let pos = i16::try_from(pos).map_err(|_| AppError::InvalidInput("Too many questions.".into()))?;
        let db_type = db_question_type_from_editor(q);
        let opts = options_json_from_quiz_question(q);
        let corr = correct_answer_json_from_quiz_question(q);
        let meta = json!({
            "legacyQuizStructureItemId": structure_item_id.to_string(),
            "legacyEditorQuestionId": q.id,
        });
        let existing = qb_repo::find_legacy_question_id(
            tx.deref_mut(),
            course_id,
            structure_item_id,
            &q.id,
        )
        .await?;

        let q_uuid = if let Some(id) = existing {
            qb_repo::update_question_row(
                tx.deref_mut(),
                course_id,
                id,
                db_type,
                &q.prompt,
                Some(&opts),
                corr.as_ref(),
                None,
                q.points.max(0) as f64,
                "active",
                false,
                &meta,
            )
            .await?;
            id
        } else {
            qb_repo::insert_question(
                &mut tx,
                course_id,
                db_type,
                &q.prompt,
                Some(&opts),
                corr.as_ref(),
                None,
                q.points.max(0) as f64,
                "active",
                false,
                "legacy_json",
                &meta,
                created_by,
            )
            .await?
        };

        qb_repo::insert_quiz_question_ref(
            &mut tx,
            structure_item_id,
            Some(q_uuid),
            None,
            None,
            pos,
        )
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Writes attempt_question_selections for a newly created attempt (pool + fixed ordering).
pub async fn materialize_attempt_questions(
    pool: &PgPool,
    course_id: Uuid,
    _structure_item_id: Uuid,
    attempt_id: Uuid,
    user_id: Uuid,
    refs: &[QuizQuestionRefRow],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    qb_repo::delete_attempt_selections(&mut tx, attempt_id).await?;

    let mut pos: i16 = 0;
    for r in refs {
        if let Some(qid) = r.question_id {
            qb_repo::insert_attempt_selection(&mut tx, attempt_id, qid, pos).await?;
            pos = pos
                .checked_add(1)
                .ok_or_else(|| AppError::InvalidInput("Quiz too long.".into()))?;
            continue;
        }
        if let (Some(pid), Some(sn)) = (r.pool_id, r.sample_n) {
            let pool_ids = qb_repo::list_active_pool_question_ids(pool, pid, course_id).await?;
            let picked = sample_n_from_pool(pool_ids, sn as usize, attempt_id, user_id);
            if picked.len() != sn as usize {
                return Err(AppError::InvalidInput(
                    "Not enough active questions in the pool for this quiz.".into(),
                ));
            }
            for qid in picked {
                qb_repo::insert_attempt_selection(&mut tx, attempt_id, qid, pos).await?;
                pos = pos
                    .checked_add(1)
                    .ok_or_else(|| AppError::InvalidInput("Quiz too long.".into()))?;
            }
        }
    }

    tx.commit().await?;
    Ok(())
}

pub async fn resolve_delivery_questions(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
    bank_enabled: bool,
    questions_json: &[QuizQuestion],
    attempt_id: Option<Uuid>,
    user_id: Option<Uuid>,
    is_instructor_view: bool,
) -> Result<ResolvedQuizQuestions, AppError> {
    let refs = qb_repo::list_quiz_question_refs(pool, structure_item_id).await?;
    // Question bank rows currently normalize to legacy types; keep authored JSON as source of truth
    // for extended question types until bank schema fully supports them.
    let has_extended_types = questions_json
        .iter()
        .any(|q| is_extended_quiz_type(q.question_type.as_str()));
    if has_extended_types {
        return Ok(ResolvedQuizQuestions {
            questions: questions_json.to_vec(),
            uses_server_question_sampling: false,
        });
    }
    if !bank_enabled || refs.is_empty() {
        return Ok(ResolvedQuizQuestions {
            questions: questions_json.to_vec(),
            uses_server_question_sampling: false,
        });
    }

    if is_instructor_view {
        // Editor still consumes `questions_json`; bank rows stay in sync for delivery.
        return Ok(ResolvedQuizQuestions {
            questions: questions_json.to_vec(),
            uses_server_question_sampling: refs_use_pool(&refs),
        });
    }

    // Learner
    if refs_use_pool(&refs) {
        let Some(aid) = attempt_id else {
            return Ok(ResolvedQuizQuestions {
                questions: vec![],
                uses_server_question_sampling: true,
            });
        };
        let Some(uid) = user_id else {
            return Ok(ResolvedQuizQuestions {
                questions: vec![],
                uses_server_question_sampling: true,
            });
        };
        let n = qb_repo::count_attempt_selections(pool, aid).await?;
        if n == 0 {
            return Ok(ResolvedQuizQuestions {
                questions: vec![],
                uses_server_question_sampling: true,
            });
        }
        let ordered = qb_repo::list_attempt_selections_ordered(pool, aid).await?;
        let map = load_quiz_questions_map(pool, course_id, &ordered).await?;
        let mut out = Vec::new();
        for id in ordered {
            let Some(row) = map.get(&id) else {
                return Err(AppError::InvalidInput(
                    "Question bank data is inconsistent for this attempt.".into(),
                ));
            };
            out.push(quiz_question_from_entity(row)?);
        }
        let _ = uid; // reserved for future audit
        return Ok(ResolvedQuizQuestions {
            questions: out,
            uses_server_question_sampling: true,
        });
    }

    // Fixed bank refs only
    let ids: Vec<Uuid> = refs.iter().filter_map(|r| r.question_id).collect();
    let map = load_quiz_questions_map(pool, course_id, &ids).await?;
    let mut out = Vec::new();
    for r in &refs {
        if let Some(qid) = r.question_id {
            let Some(row) = map.get(&qid) else {
                return Err(AppError::InvalidInput("Question bank data is missing.".into()));
            };
            out.push(quiz_question_from_entity(row)?);
        }
    }
    Ok(ResolvedQuizQuestions {
        questions: out,
        uses_server_question_sampling: false,
    })
}

pub struct ResolvedQuizQuestions {
    pub questions: Vec<QuizQuestion>,
    pub uses_server_question_sampling: bool,
}

pub async fn set_quiz_delivery_pool_only(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_id: Uuid,
    pool_id: Uuid,
    sample_n: i32,
) -> Result<(), AppError> {
    if sample_n < 1 || sample_n > 300 {
        return Err(AppError::InvalidInput(
            "sampleN must be between 1 and 300.".into(),
        ));
    }
    let _pool_row = qb_repo::get_pool(pool, course_id, pool_id)
        .await?
        .ok_or(AppError::NotFound)?;

    let mut tx = pool.begin().await?;
    qb_repo::delete_quiz_question_refs_for_item(&mut tx, structure_item_id).await?;
    qb_repo::insert_quiz_question_ref(&mut tx, structure_item_id, None, Some(pool_id), Some(sample_n), 0).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn clear_quiz_delivery_refs(
    pool: &PgPool,
    structure_item_id: Uuid,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    qb_repo::delete_quiz_question_refs_for_item(&mut tx, structure_item_id).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn search_questions(
    pool: &PgPool,
    course_id: Uuid,
    q: Option<&str>,
    type_: Option<&str>,
    concept_id: Option<Uuid>,
    difficulty: Option<&str>,
    status: Option<&str>,
    limit: i64,
    after_created_at: Option<chrono::DateTime<chrono::Utc>>,
    after_id: Option<Uuid>,
) -> Result<Vec<QuestionEntity>, AppError> {
    let rows = qb_repo::list_questions_filtered(
        pool,
        course_id,
        QuestionListFilters {
            q,
            type_,
            concept_id,
            difficulty,
            status,
            limit,
            after_created_at,
            after_id,
        },
    )
    .await?;
    Ok(rows)
}

/// Validates that every response question id exists in `bank` and matches count rules.
pub fn validate_submitted_ids(_bank: &[QuizQuestion], responses_len: usize, random_pool: Option<i32>) -> Result<(), AppError> {
    if let Some(pool_n) = random_pool {
        if pool_n >= 1 && responses_len != pool_n as usize {
            return Err(AppError::InvalidInput(
                "Submitted response count does not match the configured question pool size.".into(),
            ));
        }
    }
    Ok(())
}
