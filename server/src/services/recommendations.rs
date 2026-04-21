//! Rule-based recommendations (plan 1.8): pure scoring helpers + orchestration.

use std::collections::{HashMap, HashSet};
use std::env;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::course::CoursePublic;
use crate::models::course_structure::CourseStructureItemRow;
use crate::repos::adaptive_path as adaptive_path_repo;
use crate::repos::concepts;
use crate::repos::course;
use crate::repos::course_structure;
use crate::repos::enrollment;
use crate::repos::learner_model;
use crate::repos::recommendations as rec_repo;
use crate::repos::srs as srs_repo;
use crate::services::adaptive_path as adaptive_path_service;
use crate::services::competency_gating;
use crate::services::learner_state;
use crate::services::srs::{srs_active_for_course, srs_practice_globally_enabled};

const CACHE_TTL_SECS: i64 = 300;
const MAX_RECOMMENDATIONS: usize = 10;
const PREREQ_THRESHOLD: f64 = 0.65;
const STRENGTHEN_MASTERY_CUTOFF: f64 = 0.55;
const CHALLENGE_SELF_MAX: f64 = 0.78;

/// `RECOMMENDATIONS_ENABLED` — platform kill-switch (default off).
pub fn recommendations_globally_enabled() -> bool {
    match env::var("RECOMMENDATIONS_ENABLED") {
        Ok(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn review_day_weight() -> f64 {
    env::var("RECOMMENDATIONS_REVIEW_DAY_WEIGHT")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|v: &f64| *v > 0.0 && *v < 10.0)
        .unwrap_or(0.2)
}

fn continue_recency_days() -> f64 {
    env::var("RECOMMENDATIONS_CONTINUE_RECENCY_DAYS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|v: &f64| *v >= 1.0 && *v <= 30.0)
        .unwrap_or(3.0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationDto {
    pub item_id: Uuid,
    pub item_type: String,
    pub title: String,
    pub surface: String,
    pub reason: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationsResponse {
    pub recommendations: Vec<RecommendationDto>,
    #[serde(default)]
    pub degraded: bool,
}

impl RecommendationsResponse {
    pub fn empty_ok() -> Self {
        Self {
            recommendations: vec![],
            degraded: false,
        }
    }

    pub fn degraded_empty() -> Self {
        Self {
            recommendations: vec![],
            degraded: true,
        }
    }
}

fn map_item_type(kind: &str) -> String {
    match kind {
        "quiz" => "quiz".into(),
        "content_page" => "content_page".into(),
        "assignment" => "assignment".into(),
        "external_link" => "external_link".into(),
        _ => "module".into(),
    }
}

fn tier_weight(tier: &str) -> f64 {
    match tier.trim().to_ascii_lowercase().as_str() {
        "hard" | "challenge" => 1.35,
        "easy" | "foundational" => 0.95,
        _ => 1.1,
    }
}

/// Pure: rank SRS-style review rows by overdue-ness (plan: days_overdue × weight).
pub fn rank_review_by_overdue(
    rows: &[(Uuid, chrono::DateTime<Utc>, String)],
    surface: &str,
    now: chrono::DateTime<Utc>,
) -> Vec<RecommendationDto> {
    let w = review_day_weight();
    let mut scored: Vec<(f64, RecommendationDto)> = rows
        .iter()
        .map(|(qid, due, title)| {
            let overdue_days = (now - *due).num_seconds() as f64 / 86400.0;
            let score = overdue_days.max(0.0) * w;
            let reason = format!("rec.review.overdue|days={}", overdue_days.round() as i64);
            (
                score,
                RecommendationDto {
                    item_id: *qid,
                    item_type: "review_card".into(),
                    title: title.clone(),
                    surface: surface.into(),
                    reason,
                    score,
                },
            )
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().map(|(_, r)| r).collect()
}

/// Pure: strengthen ordering — weakest mastery first, weighted by concept importance.
pub fn rank_strengthen(
    weak: &[(Uuid, f64, String, f64)],
    surface: &str,
    structure_item_id: Uuid,
    item_title: &str,
) -> Vec<RecommendationDto> {
    let mut v: Vec<(f64, RecommendationDto)> = weak
        .iter()
        .map(|(_concept_id, mastery, concept_name, importance)| {
            let score = (1.0 - *mastery).clamp(0.0, 1.0) * importance;
            let reason = format!("rec.strengthen.weakConcept|concept={}", concept_name);
            (
                score,
                RecommendationDto {
                    item_id: structure_item_id,
                    item_type: "quiz".into(),
                    title: item_title.into(),
                    surface: surface.into(),
                    reason,
                    score,
                },
            )
        })
        .collect();
    v.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    v.into_iter().map(|(_, r)| r).collect()
}

/// Pure: challenge candidates sorted by readiness gap.
pub fn rank_challenge(items: &[(Uuid, String, f64)], surface: &str) -> Vec<RecommendationDto> {
    let mut v: Vec<(f64, RecommendationDto)> = items
        .iter()
        .map(|(sid, title, score)| {
            let reason = "rec.challenge.readyNext".to_string();
            (
                *score,
                RecommendationDto {
                    item_id: *sid,
                    item_type: "quiz".into(),
                    title: title.clone(),
                    surface: surface.into(),
                    reason,
                    score: *score,
                },
            )
        })
        .collect();
    v.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    v.into_iter().map(|(_, r)| r).collect()
}

fn prereqs_satisfied(
    concept_id: Uuid,
    prereq_edges: &[(Uuid, Uuid)],
    mastery: &HashMap<Uuid, f64>,
) -> bool {
    let prereqs: Vec<Uuid> = prereq_edges
        .iter()
        .filter_map(|(c, p)| if *c == concept_id { Some(*p) } else { None })
        .collect();
    if prereqs.is_empty() {
        return true;
    }
    prereqs
        .iter()
        .all(|p| *mastery.get(p).unwrap_or(&0.0) >= PREREQ_THRESHOLD - f64::EPSILON)
}

fn apply_suppress_pins(
    mut recs: Vec<RecommendationDto>,
    suppressed: &HashSet<Uuid>,
    pinned_continue: &[Uuid],
    surface: &str,
    pin_titles: &HashMap<Uuid, String>,
) -> Vec<RecommendationDto> {
    recs.retain(|r| !suppressed.contains(&r.item_id));
    if surface == "continue" && !pinned_continue.is_empty() {
        let mut pinned_rows = Vec::new();
        let mut rest = Vec::new();
        for p in pinned_continue {
            if let Some(pos) = recs.iter().position(|r| r.item_id == *p) {
                pinned_rows.push(recs.remove(pos));
            } else if !suppressed.contains(p) {
                let title = pin_titles
                    .get(p)
                    .cloned()
                    .unwrap_or_else(|| "Pinned item".into());
                pinned_rows.push(RecommendationDto {
                    item_id: *p,
                    item_type: "module".into(),
                    title,
                    surface: surface.into(),
                    reason: "rec.continue.instructorPin".into(),
                    score: 1_000_000.0,
                });
            }
        }
        for r in recs {
            if !pinned_continue.contains(&r.item_id) {
                rest.push(r);
            }
        }
        pinned_rows.extend(rest);
        recs = pinned_rows;
    }
    recs.into_iter().take(MAX_RECOMMENDATIONS).collect()
}

/// Build recommendations for one surface (DB + pure scoring).
pub async fn compute_surface(
    pool: &PgPool,
    course: &CoursePublic,
    target_user_id: Uuid,
    surface: &str,
    structure_rows: &[CourseStructureItemRow],
    _is_staff_view: bool,
) -> Result<RecommendationsResponse, sqlx::Error> {
    let overrides = rec_repo::list_overrides_for_course(pool, course.id).await?;
    let mut suppressed = HashSet::new();
    let mut pinned_continue: Vec<Uuid> = Vec::new();
    for o in &overrides {
        match o.override_type.as_str() {
            "suppress" if o.surface.as_deref().unwrap_or(surface) == surface => {
                suppressed.insert(o.structure_item_id);
            }
            "pin"
                if surface == "continue"
                    && (o.surface.is_none() || o.surface.as_deref() == Some("continue")) =>
            {
                pinned_continue.push(o.structure_item_id);
            }
            _ => {}
        }
    }

    let now = Utc::now();
    let nav_ids = course_structure::navigable_ids_in_outline_order(structure_rows.to_vec());
    let nav_pos: HashMap<Uuid, usize> = nav_ids.iter().enumerate().map(|(i, u)| (*u, i)).collect();
    let pin_titles: HashMap<Uuid, String> = structure_rows
        .iter()
        .map(|r| (r.id, r.title.clone()))
        .collect();

    let degraded = false;

    let out = match surface {
        "review" => {
            if !srs_active_for_course(srs_practice_globally_enabled(), course.srs_enabled) {
                return Ok(RecommendationsResponse {
                    recommendations: vec![],
                    degraded: false,
                });
            }
            let rows =
                srs_repo::list_review_queue_for_course(pool, target_user_id, course.id, 80, 0)
                    .await?;
            let slim: Vec<_> = rows
                .into_iter()
                .map(|r| (r.question_id, r.next_review_at, truncate_title(&r.stem)))
                .collect();
            let mut recs = rank_review_by_overdue(&slim, surface, now);
            recs = apply_suppress_pins(recs, &suppressed, &pinned_continue, surface, &pin_titles);
            RecommendationsResponse {
                recommendations: recs,
                degraded,
            }
        }
        "strengthen" | "challenge" => {
            if !learner_state::learner_model_enabled() {
                return Ok(RecommendationsResponse {
                    recommendations: vec![],
                    degraded: false,
                });
            }
            let states = learner_model::list_states_for_user_and_course(
                pool,
                target_user_id,
                course.id,
                500,
            )
            .await?;
            let concept_quiz = rec_repo::list_concept_quiz_structure_items(pool, course.id).await?;
            let mut cq_by_concept: HashMap<Uuid, Vec<&rec_repo::ConceptQuizItemRow>> =
                HashMap::new();
            for r in &concept_quiz {
                cq_by_concept.entry(r.concept_id).or_default().push(r);
            }
            let course_concepts = concepts::list_concepts_for_course(pool, course.id).await?;
            let tier_by_id: HashMap<Uuid, String> = course_concepts
                .iter()
                .map(|c| (c.id, c.difficulty_tier.clone()))
                .collect();
            let mut concept_ids: HashSet<Uuid> = states.iter().map(|s| s.concept_id).collect();
            for c in &course_concepts {
                concept_ids.insert(c.id);
            }
            let concept_ids: Vec<Uuid> = concept_ids.into_iter().collect();
            let prereq_edges = rec_repo::list_prerequisites_among_ids(pool, &concept_ids).await?;

            let mastery: HashMap<Uuid, f64> = states
                .iter()
                .map(|s| (s.concept_id, s.mastery_effective))
                .collect();

            if surface == "strengthen" {
                let mut recs: Vec<RecommendationDto> = Vec::new();
                let mut seen_quiz: HashSet<Uuid> = HashSet::new();
                let mut weak_rows: Vec<(Uuid, f64, String, f64, Uuid, String)> = Vec::new();
                for s in &states {
                    if s.mastery_effective > STRENGTHEN_MASTERY_CUTOFF + f64::EPSILON {
                        continue;
                    }
                    let tier = tier_by_id
                        .get(&s.concept_id)
                        .map(|t| t.as_str())
                        .unwrap_or("standard");
                    let importance = tier_weight(tier);
                    if let Some(items) = cq_by_concept.get(&s.concept_id) {
                        for it in items {
                            weak_rows.push((
                                s.concept_id,
                                s.mastery_effective,
                                s.concept_name.clone(),
                                importance,
                                it.structure_item_id,
                                it.title.clone(),
                            ));
                        }
                    }
                }
                weak_rows.sort_by(|a, b| {
                    a.1.partial_cmp(&b.1)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
                });
                for (cid, m, cname, imp, sid, title) in weak_rows {
                    if !seen_quiz.insert(sid) {
                        continue;
                    }
                    let one = rank_strengthen(&[(cid, m, cname, imp)], surface, sid, &title);
                    recs.extend(one);
                    if recs.len() >= MAX_RECOMMENDATIONS {
                        break;
                    }
                }
                if recs.is_empty() && !states.is_empty() {
                    for s in states
                        .iter()
                        .filter(|x| x.mastery_effective <= STRENGTHEN_MASTERY_CUTOFF)
                    {
                        if let Some(items) = cq_by_concept.get(&s.concept_id) {
                            let it = &items[0];
                            if seen_quiz.insert(it.structure_item_id) {
                                recs.extend(rank_strengthen(
                                    &[(
                                        s.concept_id,
                                        s.mastery_effective,
                                        s.concept_name.clone(),
                                        tier_weight(
                                            tier_by_id
                                                .get(&s.concept_id)
                                                .map(|t| t.as_str())
                                                .unwrap_or("standard"),
                                        ),
                                    )],
                                    surface,
                                    it.structure_item_id,
                                    &it.title,
                                ));
                            }
                        }
                        if recs.len() >= MAX_RECOMMENDATIONS {
                            break;
                        }
                    }
                }
                let recs =
                    apply_suppress_pins(recs, &suppressed, &pinned_continue, surface, &pin_titles);
                RecommendationsResponse {
                    recommendations: recs,
                    degraded,
                }
            } else {
                let mut challenge_scored: Vec<(Uuid, String, f64)> = Vec::new();
                for cid in &concept_ids {
                    let m = *mastery.get(cid).unwrap_or(&0.0);
                    if m > CHALLENGE_SELF_MAX {
                        continue;
                    }
                    if !prereqs_satisfied(*cid, &prereq_edges, &mastery) {
                        continue;
                    }
                    let Some(items) = cq_by_concept.get(cid) else {
                        continue;
                    };
                    let it = &items[0];
                    let min_prereq = prereq_edges
                        .iter()
                        .filter_map(|(c, p)| {
                            if *c == *cid {
                                Some(*mastery.get(p).unwrap_or(&0.0))
                            } else {
                                None
                            }
                        })
                        .fold(1.0f64, f64::min);
                    let score = (m + 0.15).recip() * (min_prereq + 0.1);
                    challenge_scored.push((it.structure_item_id, it.title.clone(), score));
                }
                challenge_scored
                    .sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
                challenge_scored.dedup_by(|a, b| a.0 == b.0);
                let mut recs = rank_challenge(&challenge_scored, surface);
                recs =
                    apply_suppress_pins(recs, &suppressed, &pinned_continue, surface, &pin_titles);
                RecommendationsResponse {
                    recommendations: recs,
                    degraded,
                }
            }
        }
        "continue" => {
            let enrollment_id =
                match enrollment::get_student_enrollment_id(pool, course.id, target_user_id).await?
                {
                    Some(id) => id,
                    None => {
                        return Ok(RecommendationsResponse {
                            recommendations: vec![],
                            degraded: false,
                        });
                    }
                };
            let rules = adaptive_path_repo::list_rules_for_course(pool, course.id).await?;
            let ov = adaptive_path_repo::get_path_override(pool, enrollment_id).await?;
            let mut mastery: HashMap<Uuid, f64> = HashMap::new();
            let mut mastery_failed = false;
            let global_on = adaptive_path_service::adaptive_paths_globally_enabled();
            let adaptive_on = adaptive_path_service::adaptive_paths_active_for_course(
                global_on,
                course.adaptive_paths_enabled,
            );
            if adaptive_on && ov.is_none() && learner_state::learner_model_enabled() {
                let mut concept_ids: Vec<Uuid> =
                    rules.iter().flat_map(|r| r.concept_ids.clone()).collect();
                concept_ids.sort_unstable();
                concept_ids.dedup();
                if !concept_ids.is_empty() {
                    match learner_model::list_states_for_user(
                        pool,
                        target_user_id,
                        Some(&concept_ids),
                    )
                    .await
                    {
                        Ok(states) => {
                            for s in states {
                                mastery.insert(s.concept_id, s.mastery_effective);
                            }
                        }
                        Err(_) => mastery_failed = true,
                    }
                }
            }

            let from_id = rec_repo::get_last_path_to_item(pool, enrollment_id)
                .await
                .ok()
                .flatten();

            let override_seq = ov.as_ref().map(|o| o.item_sequence.as_slice());
            let res = adaptive_path_service::resolve_next_item(
                structure_rows,
                from_id,
                &mastery,
                &rules,
                override_seq,
                adaptive_on,
                mastery_failed,
            );

            let mut recs: Vec<RecommendationDto> = Vec::new();
            if let Some(path) = res {
                if let Some(row) =
                    course_structure::get_item_row(pool, course.id, path.to_item_id).await?
                {
                    let pos = nav_pos.get(&row.id).copied().unwrap_or(0);
                    let progress_pct = if nav_ids.is_empty() {
                        0.0
                    } else {
                        pos as f64 / nav_ids.len() as f64
                    };
                    let recency_inverse = if from_id == Some(path.to_item_id) {
                        0.35
                    } else {
                        1.0
                    };
                    let score = recency_inverse + progress_pct * 2.0;
                    recs.push(RecommendationDto {
                        item_id: row.id,
                        item_type: map_item_type(&row.kind),
                        title: row.title.clone(),
                        surface: surface.into(),
                        reason: "rec.continue.nextInPath".into(),
                        score,
                    });
                }
            } else if let Some(first) = nav_ids.first() {
                if let Some(row) = course_structure::get_item_row(pool, course.id, *first).await? {
                    recs.push(RecommendationDto {
                        item_id: row.id,
                        item_type: map_item_type(&row.kind),
                        title: row.title.clone(),
                        surface: surface.into(),
                        reason: "rec.continue.startHere".into(),
                        score: 1.0,
                    });
                }
            }

            if let Some(fid) = from_id {
                if let Some(row) = course_structure::get_item_row(pool, course.id, fid).await? {
                    let days = (now - row.updated_at).num_seconds() as f64 / 86400.0;
                    let bump = if days < continue_recency_days() {
                        0.15
                    } else {
                        0.5
                    };
                    if !recs.iter().any(|r| r.item_id == fid) {
                        recs.push(RecommendationDto {
                            item_id: row.id,
                            item_type: map_item_type(&row.kind),
                            title: row.title.clone(),
                            surface: surface.into(),
                            reason: "rec.continue.resume".into(),
                            score: 2.0 + bump,
                        });
                    }
                }
            }

            recs.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            recs.dedup_by(|a, b| a.item_id == b.item_id);
            let recs =
                apply_suppress_pins(recs, &suppressed, &pinned_continue, surface, &pin_titles);
            RecommendationsResponse {
                recommendations: recs,
                degraded,
            }
        }
        _ => RecommendationsResponse::empty_ok(),
    };

    Ok(out)
}

fn truncate_title(s: &str) -> String {
    let t = s.trim();
    if t.len() <= 120 {
        t.to_string()
    } else {
        format!("{}…", &t[..117])
    }
}

/// Load structure (student view unless staff), return cached or fresh recommendations.
pub async fn get_recommendations_for_learner_course(
    pool: &PgPool,
    target_user_id: Uuid,
    course_id: Uuid,
    surface: &str,
) -> Result<RecommendationsResponse, sqlx::Error> {
    if !recommendations_globally_enabled() {
        return Ok(RecommendationsResponse::empty_ok());
    }

    let Some(course) = course::get_by_id(pool, course_id).await? else {
        return Ok(RecommendationsResponse::empty_ok());
    };

    let mut rows = course_structure::list_for_course(pool, course.id).await?;
    rows = course_structure::filter_archived_items_from_structure_list(rows);
    let is_staff =
        enrollment::user_is_course_staff(pool, &course.course_code, target_user_id).await?;
    if !is_staff {
        rows = course_structure::filter_structure_for_student_view(rows, Utc::now());
        rows = competency_gating::filter_structure_rows_for_competency_student(
            pool,
            course.id,
            course.course_type.as_str(),
            target_user_id,
            rows,
        )
        .await?;
    }

    let ttl = chrono::Duration::seconds(CACHE_TTL_SECS);
    if let Ok(Some((cached, expired))) =
        rec_repo::get_cache(pool, target_user_id, course.id, surface).await
    {
        let parse_cached = |c: &rec_repo::CachedRecommendations| -> Vec<RecommendationDto> {
            c.recommendations
                .iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect()
        };
        if !expired {
            return Ok(RecommendationsResponse {
                recommendations: parse_cached(&cached),
                degraded: cached.degraded,
            });
        }
        let recs = parse_cached(&cached);
        let degraded = cached.degraded;
        let pool_clone = pool.clone();
        let course_id = course.id;
        let rows_clone = rows.clone();
        let surface_owned = surface.to_string();
        tokio::spawn(async move {
            let Some(course_row) = course::get_by_id(&pool_clone, course_id)
                .await
                .ok()
                .flatten()
            else {
                return;
            };
            let computed = match compute_surface(
                &pool_clone,
                &course_row,
                target_user_id,
                surface_owned.as_str(),
                &rows_clone,
                is_staff,
            )
            .await
            {
                Ok(v) => v,
                Err(_) => RecommendationsResponse::degraded_empty(),
            };
            let payload = rec_repo::CachedRecommendations {
                recommendations: computed
                    .recommendations
                    .iter()
                    .filter_map(|r| serde_json::to_value(r).ok())
                    .collect(),
                degraded: computed.degraded,
            };
            let _ = rec_repo::upsert_cache(
                &pool_clone,
                target_user_id,
                course_id,
                surface_owned.as_str(),
                &payload,
                ttl,
            )
            .await;
        });
        return Ok(RecommendationsResponse {
            recommendations: recs,
            degraded,
        });
    }

    let computed =
        match compute_surface(pool, &course, target_user_id, surface, &rows, is_staff).await {
            Ok(v) => v,
            Err(_) => RecommendationsResponse::degraded_empty(),
        };
    let payload = rec_repo::CachedRecommendations {
        recommendations: computed
            .recommendations
            .iter()
            .filter_map(|r| serde_json::to_value(r).ok())
            .collect(),
        degraded: computed.degraded,
    };
    let _ = rec_repo::upsert_cache(pool, target_user_id, course.id, surface, &payload, ttl).await;

    Ok(computed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn review_surface_orders_more_overdue_first() {
        let now = Utc::now();
        let older = now - chrono::Duration::days(5);
        let newer = now - chrono::Duration::hours(2);
        let rows = vec![
            (Uuid::from_u128(1), newer, "recent".into()),
            (Uuid::from_u128(2), older, "old".into()),
        ];
        let ranked = rank_review_by_overdue(&rows, "review", now);
        assert!(ranked[0].item_id == Uuid::from_u128(2));
        assert!(ranked[0].score > ranked[1].score);
    }

    #[test]
    fn strengthen_prefers_lower_mastery() {
        let r = rank_strengthen(
            &[(Uuid::nil(), 0.2, "A".into(), 1.0)],
            "strengthen",
            Uuid::from_u128(99),
            "Quiz title",
        );
        assert_eq!(r.len(), 1);
        assert!(r[0].score > 0.7);
    }
}
