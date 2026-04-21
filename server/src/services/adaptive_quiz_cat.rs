//! Computerized adaptive testing (CAT) using banked items and 2PL IRT parameters.

use std::collections::HashSet;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_module_quiz::{AdaptiveQuizGeneratedQuestion, AdaptiveQuizHistoryTurn};
use crate::repos::question_bank as qb_repo;
use crate::repos::question_bank::QuestionEntity;
use crate::services::irt::{cat_mode_enabled, eap_theta_2pl, select_max_information_item};

fn parse_uuid_option(s: &Option<String>) -> Option<Uuid> {
    s.as_ref().and_then(|t| Uuid::parse_str(t.trim()).ok())
}

/// Convert a bank `QuestionEntity` into the adaptive quiz wire shape (MC / TF only for CAT v1).
pub fn bank_entity_to_adaptive_question(
    e: &QuestionEntity,
) -> Result<AdaptiveQuizGeneratedQuestion, AppError> {
    let qt = e.question_type.as_str();
    let (qtype, choices, weights) = match qt {
        "true_false" => {
            let choices = vec!["True".to_string(), "False".to_string()];
            let correct = e
                .correct_answer
                .as_ref()
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mut w = vec![0.0_f64, 0.0];
            w[if correct { 0 } else { 1 }] = 1.0;
            ("true_false".to_string(), choices, w)
        }
        "mc_single" | "mc_multiple" => {
            let opts = e
                .options
                .as_ref()
                .and_then(|o| o.as_array())
                .ok_or_else(|| {
                    AppError::invalid_input("Bank question is missing options for adaptive CAT.")
                })?;
            let choices: Vec<String> = opts
                .iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect();
            if choices.is_empty() {
                return Err(AppError::invalid_input(
                    "Bank question options are empty for adaptive CAT.",
                ));
            }
            let correct_idx = e
                .correct_answer
                .as_ref()
                .and_then(|c| c.get("index"))
                .and_then(|v| v.as_u64())
                .map(|u| u as usize)
                .filter(|&i| i < choices.len())
                .unwrap_or(0);
            let mut w = vec![0.0_f64; choices.len()];
            if correct_idx < w.len() {
                w[correct_idx] = 1.0;
            }
            ("multiple_choice".to_string(), choices, w)
        }
        other => {
            return Err(AppError::invalid_input(format!(
                "Question type `{other}` is not supported for IRT CAT in this version."
            )));
        }
    };

    Ok(AdaptiveQuizGeneratedQuestion {
        question_id: Some(e.id),
        prompt: e.stem.clone(),
        question_type: qtype,
        choices,
        choice_weights: weights,
        multiple_answer: qt == "mc_multiple",
        answer_with_image: false,
        required: true,
        points: e.points.round() as i32,
        estimated_minutes: 2,
    })
}

fn is_calibrated(e: &QuestionEntity) -> bool {
    e.irt_status == "calibrated"
        && e.irt_a.is_some()
        && e.irt_b.is_some()
        && e.irt_a.unwrap_or(0.0) > 0.01
}

/// Returns the next batch of CAT items (1 or 2) from the quiz pool.
pub async fn generate_cat_next_questions(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    total_questions_allowed: i32,
    history: &[AdaptiveQuizHistoryTurn],
    batch_size: i32,
) -> Result<Vec<AdaptiveQuizGeneratedQuestion>, AppError> {
    if !cat_mode_enabled() {
        return Err(AppError::invalid_input(
            "IRT CAT mode is disabled on this server (set IRT_CAT_MODE_ENABLED=1).",
        ));
    }

    let refs = qb_repo::list_quiz_question_refs(pool, item_id).await?;
    let pool_ref = refs
        .iter()
        .find(|r| r.pool_id.is_some() && r.question_id.is_none())
        .ok_or_else(|| {
            AppError::invalid_input(
                "CAT adaptive quizzes require exactly one question-pool delivery row on the quiz.",
            )
        })?;
    if refs.iter().filter(|r| r.pool_id.is_some()).count() != 1 || refs.len() != 1 {
        return Err(AppError::invalid_input(
            "CAT adaptive quizzes must use a single pool-only delivery spec (no mixed fixed rows).",
        ));
    }
    let pool_id = pool_ref.pool_id.expect("checked");

    let pool_ids = qb_repo::list_active_pool_question_ids(pool, pool_id, course_id).await?;
    if pool_ids.is_empty() {
        return Err(AppError::invalid_input(
            "The CAT question pool has no active items.",
        ));
    }

    let answered = history.len() as i32;
    if answered >= total_questions_allowed {
        return Err(AppError::invalid_input(
            "No more questions in this adaptive attempt.",
        ));
    }
    let expected = batch_size.clamp(1, 2) as usize;
    let remaining_after_batch = (total_questions_allowed - answered) as usize;
    if expected > remaining_after_batch {
        return Err(AppError::invalid_input(
            "Adaptive batch size exceeds remaining questions.",
        ));
    }

    let mut used: HashSet<Uuid> = HashSet::new();
    let mut irt_rows: Vec<(f64, f64, u8)> = Vec::new();
    for turn in history {
        let Some(qid) = parse_uuid_option(&turn.question_id) else {
            continue;
        };
        used.insert(qid);
        let Some(ent) = qb_repo::get_question(pool, course_id, qid).await? else {
            continue;
        };
        if !is_calibrated(&ent) {
            continue;
        }
        let a = ent.irt_a.unwrap_or(1.0);
        let b = ent.irt_b.unwrap_or(0.0);
        let u = if crate::services::quiz_attempt_grading::adaptive_turn_is_correct(turn) {
            1_u8
        } else {
            0_u8
        };
        irt_rows.push((a, b, u));
    }

    let (theta_hat, _) = eap_theta_2pl(&irt_rows);

    let mut entities: Vec<QuestionEntity> = Vec::new();
    for pid in &pool_ids {
        if let Some(e) = qb_repo::get_question(pool, course_id, *pid).await? {
            entities.push(e);
        }
    }

    let calibrated_any = entities.iter().any(is_calibrated);
    if !calibrated_any {
        tracing::warn!(
            target: "irt.cat",
            quiz_item_id = %item_id,
            "CAT requested but no calibrated items in pool; falling back to random selection."
        );
    }

    let candidates: Vec<(Uuid, Option<f64>, Option<f64>)> =
        entities.iter().map(|e| (e.id, e.irt_a, e.irt_b)).collect();
    let exclude: Vec<Uuid> = used.iter().copied().collect();

    let mut chosen: Vec<Uuid> = Vec::new();
    let mut rng_theta = theta_hat;
    for _ in 0..expected {
        let mut banned: Vec<Uuid> = exclude.clone();
        banned.extend(chosen.iter().copied());
        let pick = if calibrated_any {
            select_max_information_item(rng_theta, &candidates, &banned, true).or_else(|| {
                tracing::warn!(
                    target: "irt.cat",
                    "No calibrated item left; random fallback within pool."
                );
                random_unused(&pool_ids, &banned, &[])
            })
        } else {
            random_unused(&pool_ids, &banned, &[])
        };
        let Some(pid) = pick else {
            return Err(AppError::invalid_input(
                "Could not select another question from the CAT pool.",
            ));
        };
        chosen.push(pid);
        if let Some(ent) = entities.iter().find(|e| e.id == pid) {
            if is_calibrated(ent) {
                let a = ent.irt_a.unwrap_or(1.0);
                let b = ent.irt_b.unwrap_or(0.0);
                rng_theta = rng_theta + 0.15 * (a * (rng_theta - b)).tanh();
            }
        }
    }

    let mut out = Vec::with_capacity(expected);
    for pid in chosen {
        let ent = entities
            .iter()
            .find(|e| e.id == pid)
            .ok_or_else(|| AppError::invalid_input("CAT selection referenced missing entity."))?;
        out.push(bank_entity_to_adaptive_question(ent)?);
    }
    Ok(out)
}

fn random_unused(pool: &[Uuid], exclude: &[Uuid], extra: &[Uuid]) -> Option<Uuid> {
    use rand::seq::SliceRandom;
    let mut cand: Vec<Uuid> = pool
        .iter()
        .copied()
        .filter(|id| !exclude.contains(id) && !extra.contains(id))
        .collect();
    if cand.is_empty() {
        return None;
    }
    let mut rng = rand::rng();
    cand.shuffle(&mut rng);
    cand.pop()
}
