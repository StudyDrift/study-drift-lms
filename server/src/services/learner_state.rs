//! Learner knowledge state: exponential moving average mastery, time decay on read, quiz integrations.

use std::collections::HashMap;
use std::env;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::Postgres;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_module_quiz::QuizQuestion;
use crate::repos::enrollment;
use crate::repos::learner_model::{
    self, apply_mastery_update_in_tx, list_states_for_user, LearnerConceptStateRow,
    LearnerModelUpdateInput,
};
use crate::repos::quiz_attempts::QuizResponseRow;

/// `ADAPTIVE_LEARNER_MODEL_ENABLED` — default `false` (see rollout plan).
pub fn learner_model_enabled() -> bool {
    match env::var("ADAPTIVE_LEARNER_MODEL_ENABLED") {
        Ok(v) => matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        Err(_) => false,
    }
}

/// EMA smoothing factor for mastery updates (env `LEARNER_MODEL_EMA_ALPHA`, default 0.3).
pub fn learner_ema_alpha() -> f64 {
    ema_alpha()
}

fn ema_alpha() -> f64 {
    env::var("LEARNER_MODEL_EMA_ALPHA")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .filter(|a: &f64| *a > 0.0 && *a <= 1.0)
        .unwrap_or(0.3)
}

fn short_user_hash(user_id: Uuid) -> String {
    let mut h = Sha256::new();
    h.update(user_id.as_bytes());
    let d = h.finalize();
    format!(
        "{:02x}{:02x}{:02x}{:02x}",
        d[0], d[1], d[2], d[3]
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptStateResponse {
    pub concept_id: Uuid,
    pub concept_name: String,
    pub mastery: f64,
    pub attempt_count: i32,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub needs_review_at: Option<DateTime<Utc>>,
}

impl From<LearnerConceptStateRow> for ConceptStateResponse {
    fn from(r: LearnerConceptStateRow) -> Self {
        ConceptStateResponse {
            concept_id: r.concept_id,
            concept_name: r.concept_name,
            mastery: r.mastery_effective,
            attempt_count: r.attempt_count,
            last_seen_at: r.last_seen_at,
            needs_review_at: r.needs_review_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerConceptsListResponse {
    pub concepts: Vec<ConceptStateResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerConceptsBatchResponse {
    pub states: HashMap<Uuid, Vec<ConceptStateResponse>>,
}

#[async_trait]
pub trait LearnerStateService: Send + Sync {
    async fn list_concept_states(
        &self,
        pool: &sqlx::PgPool,
        user_id: Uuid,
        concept_ids: Option<&[Uuid]>,
    ) -> Result<Vec<ConceptStateResponse>, AppError>;

    /// Mastery snapshot text for adaptive quiz prompts (no PII — uses hashed user id only in logs elsewhere).
    async fn course_mastery_summary_for_prompt(
        &self,
        pool: &sqlx::PgPool,
        course_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<String>, AppError>;
}

pub struct PgLearnerStateService;

#[async_trait]
impl LearnerStateService for PgLearnerStateService {
    async fn list_concept_states(
        &self,
        pool: &sqlx::PgPool,
        user_id: Uuid,
        concept_ids: Option<&[Uuid]>,
    ) -> Result<Vec<ConceptStateResponse>, AppError> {
        let rows = list_states_for_user(pool, user_id, concept_ids)
            .await
            .map_err(AppError::Db)?;
        Ok(rows.into_iter().map(ConceptStateResponse::from).collect())
    }

    async fn course_mastery_summary_for_prompt(
        &self,
        pool: &sqlx::PgPool,
        course_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<String>, AppError> {
        if !learner_model_enabled() {
            return Ok(None);
        }
        let rows = learner_model::list_states_for_user_and_course(pool, user_id, course_id, 40)
            .await
            .map_err(AppError::Db)?;
        if rows.is_empty() {
            return Ok(None);
        }
        let mut parts = Vec::new();
        for r in rows {
            parts.push(format!(
                "{}: {:0.2} ({} attempts)",
                r.concept_name, r.mastery_effective, r.attempt_count
            ));
        }
        Ok(Some(parts.join("; ")))
    }
}

pub static DEFAULT_LEARNER_STATE_SERVICE: PgLearnerStateService = PgLearnerStateService;

pub async fn assert_can_read_learner_state(
    pool: &sqlx::PgPool,
    caller_id: Uuid,
    target_id: Uuid,
) -> Result<(), AppError> {
    if caller_id == target_id {
        return Ok(());
    }
    let ok = enrollment::staff_sees_student_in_shared_course(pool, caller_id, target_id).await?;
    if ok {
        return Ok(());
    }
    Err(AppError::Forbidden)
}

pub async fn assert_can_batch_read_learner_states(
    pool: &sqlx::PgPool,
    caller_id: Uuid,
    target_ids: &[Uuid],
) -> Result<(), AppError> {
    for tid in target_ids {
        if *tid == caller_id {
            continue;
        }
        let ok = enrollment::staff_sees_student_in_shared_course(pool, caller_id, *tid).await?;
        if !ok {
            return Err(AppError::Forbidden);
        }
    }
    Ok(())
}

/// Apply all concept updates after individual questions are graded, before the attempt is finalized.
pub async fn apply_quiz_grades_mastery<'e, E>(
    executor: &mut E,
    course_id: Uuid,
    user_id: Uuid,
    attempt_id: Uuid,
    touches: &[(Uuid, f64, i32, f64)],
) -> Result<(), AppError>
where
    for<'a> &'a mut E: sqlx::Executor<'a, Database = Postgres>,
{
    if !learner_model_enabled() {
        return Ok(());
    }
    let alpha = ema_alpha();
    for &(concept_id, score, q_index, ema_alpha_mult) in touches {
        let input = LearnerModelUpdateInput {
            user_id,
            attempt_id,
            course_id,
            concept_id,
            score,
            question_index: q_index,
            ema_alpha: alpha,
            ema_alpha_multiplier: ema_alpha_mult,
        };
        apply_mastery_update_in_tx(executor, &input)
            .await
            .map_err(AppError::Db)?;

        let delta_dir = if score >= 0.5 { "up" } else { "down" };
        tracing::debug!(
            target: "learner_mastery",
            user_id_hash = %short_user_hash(user_id),
            concept_id = %concept_id,
            delta_direction = delta_dir,
            question_index = q_index,
            "mastery.updated"
        );
    }
    Ok(())
}

pub fn collect_concept_touches_from_question(
    q: &QuizQuestion,
    q_index: i32,
    pts: f64,
    max_pts: f64,
    extra_concept_ids: &[Uuid],
    mastery_scale: f64,
    ema_alpha_multiplier: f64,
    out: &mut Vec<(Uuid, f64, i32, f64)>,
) {
    use std::collections::HashSet;
    let denom = if max_pts > 0.0 { max_pts } else { 1.0 };
    let score = (pts / denom).clamp(0.0, 1.0) * mastery_scale.clamp(0.0, 1.0);
    let mult = ema_alpha_multiplier.clamp(0.01, 2.0);
    let mut seen: HashSet<(Uuid, i32)> = HashSet::new();
    for sid in &q.concept_ids {
        let Ok(cid) = Uuid::parse_str(sid.trim()) else {
            continue;
        };
        let key = (cid, q_index);
        if seen.insert(key) {
            out.push((cid, score, q_index, mult));
        }
    }
    for &cid in extra_concept_ids {
        let key = (cid, q_index);
        if seen.insert(key) {
            out.push((cid, score, q_index, mult));
        }
    }
}

/// Auto-submit path: responses already stored with awarded points.
pub async fn apply_mastery_from_saved_responses<'e, E>(
    pool: &sqlx::PgPool,
    executor: &mut E,
    course_id: Uuid,
    user_id: Uuid,
    attempt_id: Uuid,
    bank: &[QuizQuestion],
    responses: &[QuizResponseRow],
    hint_scaffolding_enabled: bool,
    misconception_detection_enabled: bool,
) -> Result<(), AppError>
where
    for<'a> &'a mut E: sqlx::Executor<'a, Database = Postgres>,
{
    if !learner_model_enabled() {
        return Ok(());
    }
    let hint_counts = if hint_scaffolding_enabled {
        crate::repos::hints::hint_use_counts_for_attempt(pool, attempt_id)
            .await
            .map_err(AppError::Db)?
    } else {
        std::collections::HashMap::new()
    };
    let mut by_id: HashMap<String, &QuizQuestion> = HashMap::new();
    for q in bank {
        by_id.insert(q.id.clone(), q);
    }
    let qids: Vec<Uuid> = bank
        .iter()
        .filter_map(|q| Uuid::parse_str(&q.id).ok())
        .collect();
    let tag_map = crate::repos::concepts::concept_ids_for_question_ids(pool, &qids)
        .await
        .map_err(AppError::Db)?;
    let mut touches = Vec::new();
    for r in responses {
        let Some(qid) = r.question_id.as_deref() else {
            continue;
        };
        let Some(q) = by_id.get(qid) else {
            continue;
        };
        let max = r.max_points;
        let pts = r.points_awarded.unwrap_or(0.0);
        let extra: &[Uuid] = Uuid::parse_str(qid)
            .ok()
            .and_then(|u| tag_map.get(&u).map(|v| v.as_slice()))
            .unwrap_or(&[]);
        let hint_n = *hint_counts.get(qid).unwrap_or(&0);
        let ms = crate::services::hint_service::mastery_scale_for_hint_uses(hint_n);
        let mut ema_mult = 1.0_f64;
        if misconception_detection_enabled && r.is_correct == Some(false) {
            if let Ok(resp_item) =
                serde_json::from_value::<crate::models::course_module_quiz::QuizQuestionResponseItem>(
                    r.response_json.clone(),
                )
            {
                if let Some(sel) = resp_item.selected_choice_index {
                    if let Ok(quuid) = Uuid::parse_str(qid) {
                        let hit = crate::services::misconception::record_wrong_multiple_choice(
                            executor,
                            pool,
                            course_id,
                            user_id,
                            attempt_id,
                            quuid,
                            q,
                            sel,
                            misconception_detection_enabled,
                        )
                        .await;
                        if hit.is_some() {
                            ema_mult = crate::services::misconception::mastery_alpha_multiplier_for_misconception_hit();
                        }
                    }
                }
            }
        }
        collect_concept_touches_from_question(
            q,
            r.question_index,
            pts,
            max,
            extra,
            ms,
            ema_mult,
            &mut touches,
        );
    }
    apply_quiz_grades_mastery(executor, course_id, user_id, attempt_id, &touches).await
}
