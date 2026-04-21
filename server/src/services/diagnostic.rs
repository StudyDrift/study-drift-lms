//! Diagnostic / placement assessment orchestration (plan 1.7).

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};
use crate::models::course_module_quiz::AdaptiveQuizGeneratedQuestion;
use crate::repos::adaptive_path as adaptive_path_repo;
use crate::repos::course_structure;
use crate::repos::diagnostic as diagnostic_repo;
use crate::repos::enrollment;
use crate::repos::learner_model;
use crate::repos::question_bank as qb_repo;
use crate::repos::question_bank::QuestionEntity;
use crate::services::adaptive_path as adaptive_path_service;
use crate::services::adaptive_quiz_cat::bank_entity_to_adaptive_question;
use crate::services::irt::{cat_mode_enabled, eap_theta_2pl, select_max_information_item};

const DEFAULT_THETA_CUTS: [f64; 3] = [-1.0, 0.0, 1.0];

/// `DIAGNOSTIC_ASSESSMENTS_ENABLED` — platform kill-switch (default off).
pub fn diagnostic_assessments_globally_enabled() -> bool {
    match std::env::var("DIAGNOSTIC_ASSESSMENTS_ENABLED") {
        Ok(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

pub fn diagnostic_active_for_course(global_on: bool, course_flag: bool, has_config: bool) -> bool {
    global_on && course_flag && has_config
}

#[inline]
pub fn theta_to_mastery(theta: f64) -> f64 {
    let x = (-theta).exp();
    (1.0 / (1.0 + x)).clamp(0.0, 1.0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProficiencyTier {
    Beginner,
    Developing,
    Proficient,
    Advanced,
}

impl ProficiencyTier {
    pub fn i18n_key(self) -> &'static str {
        match self {
            ProficiencyTier::Beginner => "diagnostic.proficiency.beginner",
            ProficiencyTier::Developing => "diagnostic.proficiency.developing",
            ProficiencyTier::Proficient => "diagnostic.proficiency.proficient",
            ProficiencyTier::Advanced => "diagnostic.proficiency.advanced",
        }
    }

    pub fn display_label(self) -> &'static str {
        match self {
            ProficiencyTier::Beginner => "Beginner",
            ProficiencyTier::Developing => "Developing",
            ProficiencyTier::Proficient => "Proficient",
            ProficiencyTier::Advanced => "Advanced",
        }
    }
}

pub fn proficiency_for_theta(theta: f64, cuts: Option<&[f64; 3]>) -> ProficiencyTier {
    let c = cuts.unwrap_or(&DEFAULT_THETA_CUTS);
    if theta < c[0] {
        ProficiencyTier::Beginner
    } else if theta < c[1] {
        ProficiencyTier::Developing
    } else if theta < c[2] {
        ProficiencyTier::Proficient
    } else {
        ProficiencyTier::Advanced
    }
}

fn is_calibrated(e: &QuestionEntity) -> bool {
    e.irt_status == "calibrated"
        && e.irt_a.is_some()
        && e.irt_b.is_some()
        && e.irt_a.unwrap_or(0.0) > 0.01
}

fn concepts_for_entity(
    ent: &QuestionEntity,
    tag_map: &HashMap<Uuid, Vec<Uuid>>,
    diagnostic_concepts: &[Uuid],
) -> Vec<Uuid> {
    if let Some(v) = tag_map.get(&ent.id) {
        if !v.is_empty() {
            return v.clone();
        }
    }
    let mut from_meta: Vec<Uuid> = Vec::new();
    if let Some(arr) = ent.metadata.get("conceptIds").and_then(|v| v.as_array()) {
        for x in arr {
            if let Some(s) = x.as_str().and_then(|t| Uuid::parse_str(t).ok()) {
                if diagnostic_concepts.contains(&s) {
                    from_meta.push(s);
                }
            }
        }
    }
    from_meta.sort();
    from_meta.dedup();
    if !from_meta.is_empty() {
        return from_meta;
    }
    diagnostic_concepts.first().copied().into_iter().collect()
}

fn bank_answer_is_correct(ent: &QuestionEntity, choice_index: usize) -> bool {
    let qt = ent.question_type.as_str();
    match qt {
        "true_false" => ent
            .correct_answer
            .as_ref()
            .and_then(|v| v.as_bool())
            .map(|b| (choice_index == 0) == b)
            .unwrap_or(false),
        "mc_single" | "mc_multiple" => {
            let correct_idx = ent
                .correct_answer
                .as_ref()
                .and_then(|c| c.get("index"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            correct_idx == choice_index
        }
        _ => false,
    }
}

#[derive(Debug, Deserialize)]
struct PlacementRuleRow {
    #[serde(rename = "conceptId")]
    concept_id: Uuid,
    #[serde(rename = "masteryBelow")]
    mastery_below: f64,
    #[serde(rename = "startItemId")]
    start_item_id: Uuid,
}

fn placement_item_from_rules(rules: &JsonValue, mastery: &HashMap<Uuid, f64>, fallback: Uuid) -> Uuid {
    let Some(arr) = rules.as_array() else {
        return fallback;
    };
    for v in arr {
        let Ok(r) = serde_json::from_value::<PlacementRuleRow>(v.clone()) else {
            continue;
        };
        let m = *mastery.get(&r.concept_id).unwrap_or(&0.0);
        if m + f64::EPSILON < r.mastery_below {
            return r.start_item_id;
        }
    }
    fallback
}

fn should_finish_diagnostic(
    answered: usize,
    max_items: i32,
    stopping_rule: &str,
    se_threshold: f64,
    pooled_se: f64,
) -> bool {
    if answered >= max_items as usize {
        return true;
    }
    if answered < 3 {
        return false;
    }
    match stopping_rule {
        "se_threshold" | "both" => pooled_se <= se_threshold,
        _ => false,
    }
}

async fn pick_next_question_id(
    pool: &PgPool,
    course_id: Uuid,
    diagnostic: &diagnostic_repo::CourseDiagnosticRow,
    used: &HashSet<Uuid>,
    history_rows: &[(f64, f64, u8)],
    counts_by_concept: &HashMap<Uuid, usize>,
) -> Result<Option<Uuid>, AppError> {
    let pool_ids =
        qb_repo::list_active_diagnostic_question_ids(pool, course_id, &diagnostic.concept_ids)
            .await
            .map_err(AppError::Db)?;
    let available: Vec<Uuid> = pool_ids.into_iter().filter(|id| !used.contains(id)).collect();
    if available.is_empty() {
        return Ok(None);
    }

    let mut entities: Vec<QuestionEntity> = Vec::new();
    for pid in &available {
        if let Some(e) = qb_repo::get_question(pool, course_id, *pid).await.map_err(AppError::Db)? {
            entities.push(e);
        }
    }
    if entities.is_empty() {
        return Ok(None);
    }

    let tag_rows = qb_repo::list_concept_tags_for_questions(
        pool,
        &available,
        &diagnostic.concept_ids,
    )
    .await
    .map_err(AppError::Db)?;
    let mut tag_map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for r in tag_rows {
        tag_map.entry(r.question_id).or_default().push(r.concept_id);
    }
    for v in tag_map.values_mut() {
        v.sort();
        v.dedup();
    }

    let calibrated_any = entities.iter().any(is_calibrated);
    let cat_on = cat_mode_enabled() && calibrated_any;
    if cat_mode_enabled() && !calibrated_any {
        tracing::warn!(
            target: "diagnostic",
            course_id = %course_id,
            "Diagnostic CAT requested but no calibrated items; using concept-balanced random selection."
        );
    }

    if cat_on {
        let (theta_hat, _) = eap_theta_2pl(history_rows);
        let candidates: Vec<(Uuid, Option<f64>, Option<f64>)> = entities
            .iter()
            .map(|e| (e.id, e.irt_a, e.irt_b))
            .collect();
        let exclude: Vec<Uuid> = used.iter().copied().collect();
        if let Some(pid) =
            select_max_information_item(theta_hat, &candidates, &exclude, true).or_else(|| {
                select_max_information_item(theta_hat, &candidates, &exclude, false)
            })
        {
            return Ok(Some(pid));
        }
    }

    let mut best_concept: Option<Uuid> = None;
    let mut best_count = usize::MAX;
    for &cid in &diagnostic.concept_ids {
        let c = *counts_by_concept.get(&cid).unwrap_or(&0);
        let has_unused = entities.iter().any(|e| {
            concepts_for_entity(e, &tag_map, &diagnostic.concept_ids).contains(&cid)
        });
        if !has_unused {
            continue;
        }
        if c < best_count {
            best_count = c;
            best_concept = Some(cid);
        }
    }

    let target_concept = best_concept.unwrap_or_else(|| {
        diagnostic
            .concept_ids
            .first()
            .copied()
            .unwrap_or_else(Uuid::nil)
    });

    let mut cand_ids: Vec<Uuid> = entities
        .iter()
        .filter(|e| concepts_for_entity(e, &tag_map, &diagnostic.concept_ids).contains(&target_concept))
        .map(|e| e.id)
        .collect();
    if cand_ids.is_empty() {
        cand_ids = entities.iter().map(|e| e.id).collect();
    }
    use rand::seq::SliceRandom;
    let mut rng = rand::rng();
    cand_ids.shuffle(&mut rng);
    Ok(cand_ids.first().copied())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementConceptSummary {
    pub concept_id: Uuid,
    pub name: String,
    pub theta: f64,
    pub mastery: f64,
    pub proficiency_key: String,
    pub proficiency_label: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementSummary {
    pub concepts: Vec<PlacementConceptSummary>,
    pub placement_item_id: Uuid,
    pub placement_title: String,
}

async fn concept_name(pool: &PgPool, course_id: Uuid, concept_id: Uuid) -> Result<String, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM course.concepts WHERE id = $1 AND (course_id = $2 OR course_id IS NULL)",
    )
    .bind(concept_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::Db)?;
    Ok(row.map(|(n,)| n).unwrap_or_else(|| "Concept".to_string()))
}

async fn structure_title(pool: &PgPool, course_id: Uuid, item_id: Uuid) -> Result<String, AppError> {
    let row = course_structure::get_item_row(pool, course_id, item_id)
        .await
        .map_err(AppError::Db)?;
    Ok(row.map(|r| r.title).unwrap_or_else(|| "Start here".to_string()))
}

fn parse_theta_cuts(row: &diagnostic_repo::CourseDiagnosticRow) -> Option<[f64; 3]> {
    let v = row.theta_cut_scores.as_ref()?;
    let a = v.get(0)?.as_f64()?;
    let b = v.get(1)?.as_f64()?;
    let c = v.get(2)?.as_f64()?;
    Some([a, b, c])
}

async fn finalize_placement(
    pool: &PgPool,
    course_id: Uuid,
    enrollment_id: Uuid,
    user_id: Uuid,
    diagnostic: &diagnostic_repo::CourseDiagnosticRow,
    attempt_id: Uuid,
    responses: &[JsonValue],
) -> Result<(JsonValue, JsonValue, Uuid), AppError> {
    let mut per_concept_irt: HashMap<Uuid, Vec<(f64, f64, u8)>> = HashMap::new();

    for turn in responses {
        let qid = turn
            .get("questionId")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or_else(|| AppError::invalid_input("Invalid diagnostic response log."))?;
        let correct = turn.get("correct").and_then(|v| v.as_bool()).unwrap_or(false);
        let u: u8 = if correct { 1 } else { 0 };
        let Some(ent) = qb_repo::get_question(pool, course_id, qid).await.map_err(AppError::Db)? else {
            continue;
        };
        if !is_calibrated(&ent) {
            continue;
        }
        let a = ent.irt_a.unwrap_or(1.0);
        let b = ent.irt_b.unwrap_or(0.0);
        let tags = qb_repo::list_question_concepts_in_set(pool, qid, &diagnostic.concept_ids)
            .await
            .map_err(AppError::Db)?;
        let empty_map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        let cids = if !tags.is_empty() {
            tags
        } else {
            concepts_for_entity(&ent, &empty_map, &diagnostic.concept_ids)
        };
        for cid in cids {
            per_concept_irt.entry(cid).or_default().push((a, b, u));
        }
    }

    let mut theta_summary = json!({});
    let mut mastery_map: HashMap<Uuid, f64> = HashMap::new();
    for &cid in &diagnostic.concept_ids {
        let rows = per_concept_irt.get(&cid).map(|v| v.as_slice()).unwrap_or(&[]);
        let (theta, _) = eap_theta_2pl(rows);
        let m = theta_to_mastery(theta);
        theta_summary[cid.to_string()] = json!(theta);
        mastery_map.insert(cid, m);
    }

    let rows = course_structure::list_for_course(pool, course_id)
        .await
        .map_err(AppError::Db)?;
    let rows = course_structure::filter_archived_items_from_structure_list(rows);
    let nav = course_structure::navigable_ids_in_outline_order(rows.clone());
    let first = nav
        .first()
        .copied()
        .ok_or_else(|| AppError::invalid_input("Course has no navigable items for placement."))?;

    let placement_id = placement_item_from_rules(&diagnostic.placement_rules, &mastery_map, first);

    let cuts = parse_theta_cuts(diagnostic);
    let mut concepts_out = Vec::new();
    for &cid in &diagnostic.concept_ids {
        let theta = theta_summary
            .get(cid.to_string())
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let m = *mastery_map.get(&cid).unwrap_or(&0.0);
        let tier = proficiency_for_theta(theta, cuts.as_ref());
        let name = concept_name(pool, course_id, cid).await?;
        concepts_out.push(PlacementConceptSummary {
            concept_id: cid,
            name,
            theta,
            mastery: m,
            proficiency_key: tier.i18n_key().to_string(),
            proficiency_label: tier.display_label().to_string(),
        });
    }

    let title = structure_title(pool, course_id, placement_id).await?;
    let placement_summary = serde_json::to_value(PlacementSummary {
        concepts: concepts_out,
        placement_item_id: placement_id,
        placement_title: title.clone(),
    })
    .map_err(|e| {
        AppError::invalid_input_code(
            ErrorCode::Internal,
            format!("serialize placement: {e}"),
        )
    })?;

    let rules = adaptive_path_repo::list_rules_for_course(pool, course_id)
        .await
        .map_err(AppError::Db)?;
    let global_on = adaptive_path_service::adaptive_paths_globally_enabled();
    let course_row = crate::repos::course::get_by_id(pool, course_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let adaptive_on = adaptive_path_service::adaptive_paths_active_for_course(
        global_on,
        course_row.adaptive_paths_enabled,
    );
    let (path, _) =
        adaptive_path_service::preview_path_item_ids(&rows, &mastery_map, &rules, adaptive_on, 512);
    let seq: Vec<Uuid> = if let Some(pos) = path.iter().position(|&id| id == placement_id) {
        path[pos..].to_vec()
    } else {
        let pos = nav.iter().position(|&id| id == placement_id).unwrap_or(0);
        nav[pos..].to_vec()
    };
    if !seq.is_empty() {
        adaptive_path_repo::upsert_path_override(pool, enrollment_id, &seq, user_id)
            .await
            .map_err(AppError::Db)?;
    }

    let seeds: Vec<(Uuid, f64, Option<f64>, f64, i32)> = diagnostic
        .concept_ids
        .iter()
        .map(|cid| {
            let rows = per_concept_irt.get(cid).map(|v| v.as_slice()).unwrap_or(&[]);
            let (theta, se) = eap_theta_2pl(rows);
            let m = theta_to_mastery(theta);
            let n = rows.len() as i32;
            (*cid, theta, Some(se), m, n.max(1))
        })
        .collect();
    learner_model::apply_diagnostic_seed_batch(pool, user_id, attempt_id, &seeds)
        .await
        .map_err(AppError::Db)?;

    tracing::info!(
        target: "diagnostic",
        attempt_id = %attempt_id,
        course_id = %course_id,
        enrollment_id = %enrollment_id,
        placement_item_id = %placement_id,
        "diagnostic.completed"
    );

    Ok((theta_summary, placement_summary, placement_id))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticRespondBody {
    pub question_id: Uuid,
    pub choice_index: usize,
    #[serde(default)]
    pub response_ms: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticRespondResult {
    pub completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_question: Option<AdaptiveQuizGeneratedQuestion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<PlacementSummary>,
}

pub async fn respond_diagnostic_attempt(
    pool: &PgPool,
    course_id: Uuid,
    user_id: Uuid,
    attempt_id: Uuid,
    body: DiagnosticRespondBody,
) -> Result<DiagnosticRespondResult, AppError> {
    let attempt = diagnostic_repo::get_attempt_by_id(pool, attempt_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    if attempt.completed_at.is_some() {
        return Err(AppError::invalid_input("This diagnostic attempt is already finished."));
    }
    let enr = enrollment::get_enrollment_by_id(pool, attempt.enrollment_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    if enr.user_id != user_id || enr.course_id != course_id {
        return Err(AppError::Forbidden);
    }
    let diagnostic = diagnostic_repo::get_diagnostic_for_course(pool, course_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    if diagnostic.id != attempt.diagnostic_id {
        return Err(AppError::invalid_input("Diagnostic mismatch."));
    }

    let pending = attempt
        .session_state
        .get("pendingQuestionId")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| AppError::invalid_input("No pending diagnostic question."))?;
    if pending != body.question_id {
        return Err(AppError::invalid_input("Question does not match the current diagnostic item."));
    }

    let ent = qb_repo::get_question(pool, course_id, body.question_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let correct = bank_answer_is_correct(&ent, body.choice_index);

    let mut responses: Vec<JsonValue> = attempt
        .responses
        .as_array()
        .cloned()
        .unwrap_or_default();
    responses.push(json!({
        "questionId": body.question_id.to_string(),
        "choiceIndex": body.choice_index,
        "correct": correct,
        "responseMs": body.response_ms,
    }));

    let used: HashSet<Uuid> = responses
        .iter()
        .filter_map(|t| t.get("questionId").and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok()))
        .collect();

    let mut history: Vec<(f64, f64, u8)> = Vec::new();
    for t in &responses {
        let qid = t
            .get("questionId")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        let Some(qid) = qid else { continue };
        let Some(qent) = qb_repo::get_question(pool, course_id, qid).await.map_err(AppError::Db)? else {
            continue;
        };
        if !is_calibrated(&qent) {
            continue;
        }
        let a = qent.irt_a.unwrap_or(1.0);
        let b = qent.irt_b.unwrap_or(0.0);
        let u = if t.get("correct").and_then(|v| v.as_bool()).unwrap_or(false) {
            1_u8
        } else {
            0_u8
        };
        history.push((a, b, u));
    }
    let (_, pooled_se) = eap_theta_2pl(&history);

    let tag_rows = qb_repo::list_concept_tags_for_questions(pool, &used.iter().copied().collect::<Vec<_>>(), &diagnostic.concept_ids)
        .await
        .map_err(AppError::Db)?;
    let mut tag_map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for r in tag_rows {
        tag_map.entry(r.question_id).or_default().push(r.concept_id);
    }
    let mut counts: HashMap<Uuid, usize> = HashMap::new();
    for t in &responses {
        let qid = t
            .get("questionId")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        let Some(qid) = qid else { continue };
        let Some(qent) = qb_repo::get_question(pool, course_id, qid).await.map_err(AppError::Db)? else {
            continue;
        };
        for cid in concepts_for_entity(&qent, &tag_map, &diagnostic.concept_ids) {
            *counts.entry(cid).or_insert(0) += 1;
        }
    }

    let answered = responses.len();
    let done = pick_next_question_id(pool, course_id, &diagnostic, &used, &history, &counts)
        .await?
        .is_none()
        || should_finish_diagnostic(
            answered,
            diagnostic.max_items,
            diagnostic.stopping_rule.as_str(),
            diagnostic.se_threshold,
            pooled_se,
        );

    if done {
        let (theta_json, summary_json, placement_id) =
            finalize_placement(pool, course_id, attempt.enrollment_id, user_id, &diagnostic, attempt_id, &responses)
                .await?;
        diagnostic_repo::complete_attempt(
            pool,
            attempt_id,
            Some(placement_id),
            &theta_json,
            &summary_json,
            &json!(responses),
        )
        .await
        .map_err(AppError::Db)?;
        let summary: PlacementSummary = serde_json::from_value(summary_json).map_err(|e| {
            AppError::invalid_input_code(ErrorCode::Internal, format!("placement summary: {e}"))
        })?;
        return Ok(DiagnosticRespondResult {
            completed: true,
            next_question: None,
            summary: Some(summary),
        });
    }

    let next_id = pick_next_question_id(pool, course_id, &diagnostic, &used, &history, &counts)
        .await?
        .ok_or_else(|| AppError::invalid_input("No more diagnostic questions available."))?;
    let next_ent = qb_repo::get_question(pool, course_id, next_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let q = bank_entity_to_adaptive_question(&next_ent)?;
    let session = json!({ "pendingQuestionId": next_id.to_string() });
    diagnostic_repo::update_attempt_session(pool, attempt_id, &session, &json!(responses))
        .await
        .map_err(AppError::Db)?;
    Ok(DiagnosticRespondResult {
        completed: false,
        next_question: Some(q),
        summary: None,
    })
}

pub async fn start_or_resume_diagnostic(
    pool: &PgPool,
    course_id: Uuid,
    enrollment_id: Uuid,
    user_id: Uuid,
) -> Result<(Uuid, AdaptiveQuizGeneratedQuestion), AppError> {
    let diagnostic = diagnostic_repo::get_diagnostic_for_course(pool, course_id)
        .await
        .map_err(AppError::Db)?
        .ok_or_else(|| AppError::invalid_input("Diagnostic is not configured for this course."))?;

    let enr = enrollment::get_enrollment_by_id(pool, enrollment_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    if enr.user_id != user_id || enr.course_id != course_id || enr.role != "student" {
        return Err(AppError::Forbidden);
    }

    let latest = diagnostic_repo::latest_attempt_for_enrollment(pool, diagnostic.id, enrollment_id)
        .await
        .map_err(AppError::Db)?;
    if let Some(a) = &latest {
        if a.completed_at.is_some() {
            match diagnostic.retake_policy.as_str() {
                "always" => {}
                _ => {
                    return Err(AppError::invalid_input(
                        "Diagnostic was already completed for this enrollment.",
                    ));
                }
            }
        } else {
            let pending = a
                .session_state
                .get("pendingQuestionId")
                .and_then(|v| v.as_str())
                .and_then(|s| Uuid::parse_str(s).ok());
            if let Some(pid) = pending {
                let ent = qb_repo::get_question(pool, course_id, pid)
                    .await
                    .map_err(AppError::Db)?
                    .ok_or(AppError::NotFound)?;
                let q = bank_entity_to_adaptive_question(&ent)?;
                return Ok((a.id, q));
            }
        }
    }

    let pool_ok =
        qb_repo::list_active_diagnostic_question_ids(pool, course_id, &diagnostic.concept_ids)
            .await
            .map_err(AppError::Db)?;
    if pool_ok.is_empty() {
        return Err(AppError::invalid_input(
            "No eligible question-bank items found for this diagnostic (tag concepts or set metadata.conceptIds).",
        ));
    }

    let used = HashSet::new();
    let history: Vec<(f64, f64, u8)> = vec![];
    let counts: HashMap<Uuid, usize> = HashMap::new();
    let first_id = pick_next_question_id(pool, course_id, &diagnostic, &used, &history, &counts)
        .await?
        .ok_or_else(|| AppError::invalid_input("Could not select a diagnostic question."))?;
    let ent = qb_repo::get_question(pool, course_id, first_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let q = bank_entity_to_adaptive_question(&ent)?;
    let session = json!({ "pendingQuestionId": first_id.to_string() });
    let row = diagnostic_repo::insert_diagnostic_attempt(pool, diagnostic.id, enrollment_id, &session)
        .await
        .map_err(AppError::Db)?;
    Ok((row.id, q))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_proficiency_buckets() {
        assert!(matches!(
            proficiency_for_theta(-1.5, None),
            ProficiencyTier::Beginner
        ));
        assert!(matches!(
            proficiency_for_theta(-0.5, None),
            ProficiencyTier::Developing
        ));
        assert!(matches!(proficiency_for_theta(0.5, None), ProficiencyTier::Proficient));
        assert!(matches!(proficiency_for_theta(1.5, None), ProficiencyTier::Advanced));
    }

    #[test]
    fn theta_to_mastery_sigmoid() {
        assert!((theta_to_mastery(0.0) - 0.5).abs() < 1e-6);
        assert!(theta_to_mastery(3.0) > 0.9);
        assert!(theta_to_mastery(-3.0) < 0.1);
    }
}

pub async fn bypass_diagnostic_for_enrollment(
    pool: &PgPool,
    course_id: Uuid,
    enrollment_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let diagnostic = diagnostic_repo::get_diagnostic_for_course(pool, course_id)
        .await
        .map_err(AppError::Db)?
        .ok_or_else(|| AppError::invalid_input("Diagnostic is not configured for this course."))?;
    let enr = enrollment::get_enrollment_by_id(pool, enrollment_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    if enr.user_id != user_id || enr.course_id != course_id || enr.role != "student" {
        return Err(AppError::Forbidden);
    }

    let latest = diagnostic_repo::latest_attempt_for_enrollment(pool, diagnostic.id, enrollment_id)
        .await
        .map_err(AppError::Db)?;
    if let Some(a) = latest {
        if a.completed_at.is_none() {
            diagnostic_repo::bypass_attempt(pool, a.id, &json!([])).await.map_err(AppError::Db)?;
            tracing::info!(target: "diagnostic", attempt_id = %a.id, "diagnostic.bypassed");
            return Ok(());
        }
    }
    let row = diagnostic_repo::insert_bypassed_attempt(pool, diagnostic.id, enrollment_id)
        .await
        .map_err(AppError::Db)?;
    tracing::info!(target: "diagnostic", attempt_id = %row.id, "diagnostic.bypassed");
    Ok(())
}
