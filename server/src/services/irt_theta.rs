//! Persist EAP θ estimates after CAT adaptive quiz completion.

use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_module_quiz::AdaptiveQuizHistoryTurn;
use crate::repos::concepts;
use crate::repos::learner_model;
use crate::repos::question_bank as qb_repo;
use crate::services::irt::eap_theta_2pl;
use crate::services::learner_state;
use crate::services::quiz_attempt_grading;

/// Updates `learner_concept_states.theta` and appends `learner_theta_events` for each concept
/// touched by calibrated bank items in the submitted CAT history.
pub async fn apply_cat_quiz_theta_updates(
    pool: &PgPool,
    course_id: Uuid,
    user_id: Uuid,
    attempt_id: Uuid,
    hist: &[AdaptiveQuizHistoryTurn],
) -> Result<(), AppError> {
    if !learner_state::learner_model_enabled() {
        return Ok(());
    }
    let mut by_concept: HashMap<Uuid, Vec<(f64, f64, u8)>> = HashMap::new();
    let mut qids: Vec<Uuid> = Vec::new();
    for turn in hist {
        let Some(qs) = &turn.question_id else {
            continue;
        };
        let Ok(qid) = Uuid::parse_str(qs.trim()) else {
            continue;
        };
        qids.push(qid);
    }
    if qids.is_empty() {
        return Ok(());
    }
    qids.sort_unstable();
    qids.dedup();
    let tag_map = concepts::concept_ids_for_question_ids(pool, &qids)
        .await
        .map_err(AppError::Db)?;
    for turn in hist {
        let Some(qs) = &turn.question_id else {
            continue;
        };
        let Ok(qid) = Uuid::parse_str(qs.trim()) else {
            continue;
        };
        let Some(ent) = qb_repo::get_question(pool, course_id, qid).await? else {
            continue;
        };
        if ent.irt_status != "calibrated" {
            continue;
        }
        let Some(a) = ent.irt_a else {
            continue;
        };
        let Some(b) = ent.irt_b else {
            continue;
        };
        if a <= 0.01 {
            continue;
        }
        let u = if quiz_attempt_grading::adaptive_turn_is_correct(turn) {
            1_u8
        } else {
            0_u8
        };
        let tags = tag_map.get(&qid).cloned().unwrap_or_default();
        for cid in tags {
            by_concept.entry(cid).or_default().push((a, b, u));
        }
    }

    for (concept_id, rows) in by_concept {
        if rows.is_empty() {
            continue;
        }
        let (theta, se) = eap_theta_2pl(&rows);
        learner_model::record_learner_theta_snapshot(
            pool,
            user_id,
            concept_id,
            attempt_id,
            theta,
            Some(se),
            rows.len() as i32,
        )
        .await
        .map_err(AppError::Db)?;
    }
    Ok(())
}
