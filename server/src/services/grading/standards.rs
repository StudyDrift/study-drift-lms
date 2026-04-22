//! SBG proficiency rollups: aggregation strategies and recompute (plan 3.7).

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::models::assignment_rubric::RubricDefinition;
use crate::repos::course;
use crate::repos::course_grades;
use crate::repos::course_module_assignments;
use crate::repos::quiz_attempts;
use crate::repos::sbg;

const DEFAULT_DECAY: f64 = 0.65;

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ScaleLevel {
    #[allow(dead_code)]
    level: f64,
    label: String,
    #[serde(rename = "minScore", alias = "min_score")]
    min_score: f64,
}

#[derive(Debug, Deserialize)]
struct ProficiencyScale {
    levels: Option<Vec<ScaleLevel>>,
}

fn default_scale() -> Vec<ScaleLevel> {
    vec![
        ScaleLevel { level: 4.0, label: "Exceeds".into(), min_score: 3.5 },
        ScaleLevel { level: 3.0, label: "Meets".into(), min_score: 2.5 },
        ScaleLevel { level: 2.0, label: "Approaching".into(), min_score: 1.5 },
        ScaleLevel { level: 1.0, label: "Not yet".into(), min_score: 0.0 },
    ]
}

/// Parses course `sbg_proficiency_scale_json` or built-in 4-bucket scale.
fn parse_scale(json: &Option<Value>) -> Vec<ScaleLevel> {
    if let Some(v) = json {
        if let Ok(ProficiencyScale { levels: Some(mut lvls) }) = serde_json::from_value(v.clone()) {
            if !lvls.is_empty() {
                lvls.sort_by(|a, b| b.min_score.partial_cmp(&a.min_score).unwrap());
                return lvls;
            }
        }
    }
    let mut d = default_scale();
    d.sort_by(|a, b| b.min_score.partial_cmp(&a.min_score).unwrap());
    d
}

/// Map numeric 1.0..=4.0 to label.
pub(crate) fn level_label_for_score(levels: &[ScaleLevel], score: f64) -> String {
    for lv in levels {
        if score + 1e-9 >= lv.min_score {
            return lv.label.clone();
        }
    }
    if let Some(last) = levels.last() {
        return last.label.clone();
    }
    "—".into()
}

fn ratio_to_sbg(ratio: f64) -> f64 {
    (1.0 + 3.0 * ratio.clamp(0.0, 1.0)).min(4.0).max(1.0)
}

#[derive(Clone)]
struct Event {
    at: DateTime<Utc>,
    sbg_score: f64,
    weight: f64,
}

fn rubric_criterion_sbg(
    r: &RubricDefinition,
    criterion: Uuid,
    earned: f64,
) -> Option<f64> {
    for c in &r.criteria {
        if c.id == criterion {
            let max_p: f64 = c.levels.iter().map(|l| l.points).fold(0.0_f64, f64::max);
            if max_p <= 1e-9 {
                return None;
            }
            let ratio = (earned / max_p).clamp(0.0, 1.0);
            return Some(ratio_to_sbg(ratio));
        }
    }
    None
}

fn aggregate(rule: &str, events: &mut [Event], decay: f64) -> Option<(f64, DateTime<Utc>)> {
    if events.is_empty() {
        return None;
    }
    match rule {
        "highest" => {
            let best = events.iter().max_by(|a, b| {
                a.sbg_score
                    .partial_cmp(&b.sbg_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })?;
            Some((best.sbg_score, best.at))
        }
        "most_recent" => {
            events.sort_by(|a, b| b.at.cmp(&a.at));
            let e = events.first()?;
            Some((e.sbg_score, e.at))
        }
        "mean" => {
            let sum: f64 = events.iter().map(|e| e.sbg_score * e.weight).sum();
            let w: f64 = events.iter().map(|e| e.weight).sum();
            if w <= 1e-9 {
                return None;
            }
            let t = events.iter().max_by_key(|e| e.at).map(|e| e.at).unwrap();
            Some((sum / w, t))
        }
        "decaying_average" => {
            events.sort_by(|a, b| b.at.cmp(&a.at));
            let mut wsum = 0.0_f64;
            let mut num = 0.0_f64;
            for (i, e) in events.iter().enumerate() {
                let wi = e.weight * decay.powi(i as i32);
                wsum += wi;
                num += e.sbg_score * wi;
            }
            if wsum <= 1e-9 {
                return None;
            }
            let t = events.first().map(|e| e.at).unwrap();
            Some((num / wsum, t))
        }
        _ => {
            // Unknown rule — treat as most-recent
            events.sort_by(|a, b| b.at.cmp(&a.at));
            let e = events.first()?;
            Some((e.sbg_score, e.at))
        }
    }
}

/// Recompute SBG proficiencies for one student. Call after grade or quiz update.
/// `exclude_unposted` — when true, assignment grades with manual hold are omitted (e.g. learner transcript).
pub async fn recompute_student_sbg(
    pool: &PgPool,
    course_id: Uuid,
    student_id: Uuid,
    exclude_unposted: bool,
) -> Result<(), sqlx::Error> {
    let Some(crow) = course::get_by_id(pool, course_id).await? else {
        return Ok(());
    };
    if !crow.sbg_enabled {
        sbg::clear_one_student(pool, course_id, student_id).await?;
        return Ok(());
    }
    let rule = if crow.sbg_aggregation_rule.trim().is_empty() {
        "most_recent".to_string()
    } else {
        crow.sbg_aggregation_rule
    };
    let levels = parse_scale(&crow.sbg_proficiency_scale_json);
    let stds = sbg::list_course_standards(pool, course_id).await?;
    if stds.is_empty() {
        sbg::clear_one_student(pool, course_id, student_id).await?;
        return Ok(());
    }
    let alns = sbg::list_alignments_for_course(pool, course_id).await?;
    if alns.is_empty() {
        sbg::clear_one_student(pool, course_id, student_id).await?;
        return Ok(());
    }
    // Assignment rubrics for all aligned assignment items
    let mut asgn_items: Vec<Uuid> = alns
        .iter()
        .filter(|a| a.alignable_type == "rubric_criterion")
        .map(|a| a.structure_item_id)
        .collect();
    asgn_items.sort();
    asgn_items.dedup();
    let rubric_map: HashMap<Uuid, Option<RubricDefinition>> =
        if asgn_items.is_empty() {
            HashMap::new()
        } else {
            let raw = course_module_assignments::rubrics_for_structure_items(pool, course_id, &asgn_items)
                .await?;
            raw.iter()
                .map(|(id, j)| {
                    let r: Option<RubricDefinition> = j
                        .as_ref()
                        .and_then(|v| serde_json::from_value(v.clone()).ok());
                    (*id, r)
                })
                .collect()
        };
    // Grade cells for this student
    let grade_cells =
        course_grades::list_raw_for_student_sbg(pool, course_id, student_id, exclude_unposted)
            .await?;
    let id_to_grade: HashMap<Uuid, (f64, Option<serde_json::Value>, DateTime<Utc>)> = grade_cells
        .into_iter()
        .map(|(iid, pts, rub, at)| (iid, (pts, rub, at)))
        .collect();
    // Latest quiz attempts
    let quiz_tries = quiz_attempts::list_latest_submitted_attempts_for_course_student(
        pool, course_id, student_id,
    )
    .await?;
    let item_to_att: HashMap<Uuid, (Uuid, DateTime<Utc>)> = quiz_tries
        .into_iter()
        .map(|(item, att, t)| (item, (att, t)))
        .collect();

    for st in &stds {
        let mut events: Vec<Event> = Vec::new();
        for a in alns.iter().filter(|a| a.standard_id == st.id) {
            let w = a.weight;
            if a.alignable_type == "rubric_criterion" {
                let Some((_, rj, cell_at)) = id_to_grade.get(&a.structure_item_id) else {
                    continue;
                };
                let Some(rm) = rj
                    .as_ref()
                    .and_then(|r| serde_json::from_value::<HashMap<Uuid, f64>>(r.clone()).ok())
                else {
                    continue;
                };
                let Some(earned) = rm.get(&a.alignable_id) else { continue };
                let Some(def) = rubric_map.get(&a.structure_item_id).and_then(|d| d.as_ref()) else {
                    continue;
                };
                if let Some(sbg) = rubric_criterion_sbg(def, a.alignable_id, *earned) {
                    events.push(Event {
                        at: *cell_at,
                        sbg_score: sbg,
                        weight: w,
                    });
                }
            } else if a.alignable_type == "quiz_question" {
                if let Some((attempt_id, submitted)) = item_to_att.get(&a.structure_item_id) {
                    let resp_rows = quiz_attempts::list_responses(pool, *attempt_id).await?;
                    let qid = a.alignable_id.to_string();
                    for r in resp_rows {
                        if r.question_id.as_deref() == Some(&qid) {
                            let earned = r.points_awarded.unwrap_or(0.0);
                            let maxp = r.max_points;
                            if maxp > 1e-9 {
                                let sbg = ratio_to_sbg((earned / maxp).clamp(0.0, 1.0));
                                events.push(Event {
                                    at: *submitted,
                                    sbg_score: sbg,
                                    weight: w,
                                });
                            }
                            break;
                        }
                    }
                }
            }
        }
        let ev = if events.is_empty() {
            None
        } else {
            let mut e = events;
            aggregate(&rule, &mut e, DEFAULT_DECAY)
        };
        if let Some((s, t)) = ev {
            let label = level_label_for_score(&levels, s);
            sbg::upsert_proficiency(pool, course_id, student_id, st.id, Some(s), Some(&label), Some(t))
                .await?;
        } else {
            sbg::delete_proficiency(pool, course_id, student_id, st.id).await?;
        }
    }
    Ok(())
}

/// Full course recompute (e.g. after scale change or import).
pub async fn recompute_course_sbg(
    pool: &PgPool,
    course_id: Uuid,
    course_code: &str,
) -> Result<(), sqlx::Error> {
    let rosters = crate::repos::enrollment::list_student_users_for_course_code(pool, course_code)
        .await?;
    for (uid, _label) in rosters {
        recompute_student_sbg(pool, course_id, uid, false).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn most_recent_aggregation_uses_newest() {
        let mut ev = vec![
            Event {
                at: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
                sbg_score: 2.0,
                weight: 1.0,
            },
            Event {
                at: Utc.with_ymd_and_hms(2024, 2, 1, 0, 0, 0).unwrap(),
                sbg_score: 3.0,
                weight: 1.0,
            },
        ];
        let a = aggregate("most_recent", &mut ev, 0.65).unwrap();
        assert!((a.0 - 3.0).abs() < 1e-6);
    }
}