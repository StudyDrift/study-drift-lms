//! Rule-based adaptive navigation across course structure (pure evaluation + rollout gates).

use std::collections::{HashMap, HashSet};
use std::env;

use uuid::Uuid;

use crate::models::course_structure::CourseStructureItemRow;
use crate::repos::adaptive_path::StructurePathRuleRow;
use crate::repos::course_structure::{
    self, first_navigable_after_module, first_navigable_child_id, navigable_ids_in_outline_order,
    navigable_kind,
};

/// `ADAPTIVE_PATHS_ENABLED` — platform kill-switch (default off).
pub fn adaptive_paths_globally_enabled() -> bool {
    match env::var("ADAPTIVE_PATHS_ENABLED") {
        Ok(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

pub fn adaptive_paths_active_for_course(global_on: bool, course_flag: bool) -> bool {
    global_on && course_flag
}

#[derive(Debug, Clone)]
pub struct PathResolution {
    pub to_item_id: Uuid,
    pub rule_id: Option<Uuid>,
    pub skip_reason_key: Option<String>,
    pub skip_reason: Option<String>,
    pub fallback: bool,
}

fn min_mastery_for_concepts(concept_ids: &[Uuid], mastery: &HashMap<Uuid, f64>) -> f64 {
    if concept_ids.is_empty() {
        return 0.0;
    }
    concept_ids
        .iter()
        .map(|c| *mastery.get(c).unwrap_or(&0.0))
        .fold(f64::INFINITY, f64::min)
}

fn row_map(rows: &[CourseStructureItemRow]) -> HashMap<Uuid, CourseStructureItemRow> {
    rows.iter().map(|r| (r.id, r.clone())).collect()
}

fn gate_applies(
    rule_host_id: Uuid,
    candidate: Uuid,
    rows_by_id: &HashMap<Uuid, CourseStructureItemRow>,
    rows: &[CourseStructureItemRow],
) -> bool {
    let Some(host) = rows_by_id.get(&rule_host_id) else {
        return false;
    };
    if host.kind == "module" {
        first_navigable_child_id(host.id, rows) == Some(candidate)
    } else {
        rule_host_id == candidate
    }
}

fn apply_skip_if_mastered(
    rule: &StructurePathRuleRow,
    candidate: Uuid,
    rows: &[CourseStructureItemRow],
    rows_by_id: &HashMap<Uuid, CourseStructureItemRow>,
    mastery: &HashMap<Uuid, f64>,
) -> Option<Uuid> {
    if !gate_applies(rule.structure_item_id, candidate, rows_by_id, rows) {
        return None;
    }
    let m = min_mastery_for_concepts(&rule.concept_ids, mastery);
    if m + f64::EPSILON < rule.threshold {
        return None;
    }
    let host = rows_by_id.get(&rule.structure_item_id)?;
    if host.kind == "module" {
        if let Some(t) = rule.target_item_id {
            return Some(t);
        }
        return first_navigable_after_module(rows, host.id);
    }
    let nav = navigable_ids_in_outline_order(rows.to_vec());
    let pos = nav.iter().position(|&id| id == candidate)?;
    nav.get(pos + 1).copied()
}

fn apply_required_or_unlock(
    rule: &StructurePathRuleRow,
    candidate: Uuid,
    rows_by_id: &HashMap<Uuid, CourseStructureItemRow>,
    rows: &[CourseStructureItemRow],
    mastery: &HashMap<Uuid, f64>,
) -> Option<Uuid> {
    if !gate_applies(rule.structure_item_id, candidate, rows_by_id, rows) {
        return None;
    }
    let m = min_mastery_for_concepts(&rule.concept_ids, mastery);
    if m + f64::EPSILON >= rule.threshold {
        return None;
    }
    rule.target_item_id
}

fn apply_remediation_insert(
    rule: &StructurePathRuleRow,
    from_id: Option<Uuid>,
    linear_next: Option<Uuid>,
    mastery: &HashMap<Uuid, f64>,
) -> Option<Uuid> {
    let from = from_id?;
    if rule.structure_item_id != from {
        return None;
    }
    let m = min_mastery_for_concepts(&rule.concept_ids, mastery);
    if m + f64::EPSILON >= rule.threshold {
        return None;
    }
    rule.target_item_id.or(linear_next)
}

fn collect_applicable_gate_rules<'a>(
    candidate: Uuid,
    rules: &'a [StructurePathRuleRow],
    rows_by_id: &HashMap<Uuid, CourseStructureItemRow>,
    rows: &[CourseStructureItemRow],
) -> Vec<&'a StructurePathRuleRow> {
    let mut out: Vec<&StructurePathRuleRow> = rules
        .iter()
        .filter(|r| {
            r.rule_type != "remediation_insert"
                && gate_applies(r.structure_item_id, candidate, rows_by_id, rows)
        })
        .collect();
    out.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| a.created_at.cmp(&b.created_at))
    });
    out
}

fn collect_remediation_rules(
    from_id: Option<Uuid>,
    rules: &[StructurePathRuleRow],
) -> Vec<&StructurePathRuleRow> {
    let Some(fid) = from_id else {
        return vec![];
    };
    let mut out: Vec<&StructurePathRuleRow> = rules
        .iter()
        .filter(|r| r.rule_type == "remediation_insert" && r.structure_item_id == fid)
        .collect();
    out.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| a.created_at.cmp(&b.created_at))
    });
    out
}

fn linear_next_nav(rows: &[CourseStructureItemRow], from_id: Option<Uuid>) -> Option<Uuid> {
    let nav = navigable_ids_in_outline_order(rows.to_vec());
    if nav.is_empty() {
        return None;
    }
    let Some(from) = from_id else {
        return Some(nav[0]);
    };
    let pos = nav.iter().position(|&id| id == from)?;
    nav.get(pos + 1).copied()
}

fn linear_next_override(seq: &[Uuid], from_id: Option<Uuid>) -> Option<Uuid> {
    if seq.is_empty() {
        return None;
    }
    match from_id {
        None => Some(seq[0]),
        Some(fid) => {
            let pos = seq.iter().position(|&id| id == fid)?;
            seq.get(pos + 1).copied()
        }
    }
}

/// Pure resolution: returns the next structure item id and optional applied rule metadata.
pub fn resolve_next_item(
    rows: &[CourseStructureItemRow],
    from_item_id: Option<Uuid>,
    mastery: &HashMap<Uuid, f64>,
    rules: &[StructurePathRuleRow],
    override_seq: Option<&[Uuid]>,
    adaptive_enabled: bool,
    mastery_failed: bool,
) -> Option<PathResolution> {
    let rows_by_id = row_map(rows);

    if let Some(seq) = override_seq {
        let to = linear_next_override(seq, from_item_id)?;
        return Some(PathResolution {
            to_item_id: to,
            rule_id: None,
            skip_reason_key: None,
            skip_reason: None,
            fallback: false,
        });
    }

    if !adaptive_enabled || mastery_failed {
        let to = linear_next_nav(rows, from_item_id)?;
        return Some(PathResolution {
            to_item_id: to,
            rule_id: None,
            skip_reason_key: None,
            skip_reason: None,
            fallback: mastery_failed,
        });
    }

    let mut candidate = linear_next_nav(rows, from_item_id)?;

    let linear_next = candidate;
    for r in collect_remediation_rules(from_item_id, rules) {
        if let Some(to) = apply_remediation_insert(r, from_item_id, Some(linear_next), mastery) {
            if to != candidate {
                candidate = to;
                return Some(PathResolution {
                    to_item_id: candidate,
                    rule_id: Some(r.id),
                    skip_reason_key: Some("adaptivePath.remediationInsert".to_string()),
                    skip_reason: Some(
                        "Based on your recent results, you will review a related topic first."
                            .to_string(),
                    ),
                    fallback: false,
                });
            }
        }
    }

    let mut applied_rule: Option<Uuid> = None;
    let mut skip_key: Option<String> = None;
    let mut skip_msg: Option<String> = None;

    for _ in 0..12usize {
        let applicable = collect_applicable_gate_rules(candidate, rules, &rows_by_id, rows);
        let mut changed = false;
        for rule in applicable {
            match rule.rule_type.as_str() {
                "skip_if_mastered" => {
                    if let Some(to) =
                        apply_skip_if_mastered(rule, candidate, rows, &rows_by_id, mastery)
                    {
                        if to != candidate {
                            applied_rule = Some(rule.id);
                            skip_key = Some("adaptivePath.skipMastered".to_string());
                            skip_msg = Some(
                                "Skipping this section — you already demonstrated mastery."
                                    .to_string(),
                            );
                            candidate = to;
                            changed = true;
                            break;
                        }
                    }
                }
                "required_if_not_mastered" | "unlock_after" => {
                    if let Some(to) =
                        apply_required_or_unlock(rule, candidate, &rows_by_id, rows, mastery)
                    {
                        if to != candidate {
                            applied_rule = Some(rule.id);
                            skip_key = Some("adaptivePath.remediationRequired".to_string());
                            skip_msg = Some(
                                "You will work through a review section before continuing."
                                    .to_string(),
                            );
                            candidate = to;
                            changed = true;
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        if !changed {
            break;
        }
    }

    Some(PathResolution {
        to_item_id: candidate,
        rule_id: applied_rule,
        skip_reason_key: skip_key,
        skip_reason: skip_msg,
        fallback: false,
    })
}

/// Validates that all ids in the sequence are navigable items in this course outline.
pub fn validate_override_sequence(rows: &[CourseStructureItemRow], seq: &[Uuid]) -> bool {
    if seq.is_empty() {
        return false;
    }
    let allowed: HashSet<Uuid> = rows
        .iter()
        .filter(|r| navigable_kind(&r.kind))
        .map(|r| r.id)
        .collect();
    seq.iter().all(|id| allowed.contains(id))
}

/// Preview path: repeatedly resolve from a synthetic starting point using hypothetical mastery.
pub fn preview_path_item_ids(
    rows: &[CourseStructureItemRow],
    mastery: &HashMap<Uuid, f64>,
    rules: &[StructurePathRuleRow],
    adaptive_enabled: bool,
    max_steps: usize,
) -> (Vec<Uuid>, bool) {
    let mut out = Vec::new();
    let mut from: Option<Uuid> = None;
    let mut fallback = false;
    for _ in 0..max_steps {
        let Some(res) =
            resolve_next_item(rows, from, mastery, rules, None, adaptive_enabled, false)
        else {
            break;
        };
        if res.fallback {
            fallback = true;
        }
        if out.last().copied() == Some(res.to_item_id) {
            break;
        }
        out.push(res.to_item_id);
        from = Some(res.to_item_id);
    }
    (out, fallback)
}

/// Ensures target items (when present) belong to the same course as the host structure item.
pub async fn validate_rule_targets_in_course(
    pool: &sqlx::PgPool,
    course_id: Uuid,
    host_item_id: Uuid,
    target_item_id: Option<Uuid>,
) -> Result<(), crate::error::AppError> {
    if let Some(t) = target_item_id {
        let ok_host = course_structure::get_item_row(pool, course_id, host_item_id)
            .await?
            .is_some();
        if !ok_host {
            return Err(crate::error::AppError::invalid_input(
                "structureItemId is not part of this course.",
            ));
        }
        let ok_t = course_structure::get_item_row(pool, course_id, t)
            .await?
            .is_some();
        if !ok_t {
            return Err(crate::error::AppError::invalid_input(
                "targetItemId is not part of this course.",
            ));
        }
    }
    Ok(())
}

/// Validates concept ids belong to the course (or are tagged to course questions — same as learner model).
pub async fn validate_concepts_for_course(
    pool: &sqlx::PgPool,
    course_id: Uuid,
    concept_ids: &[Uuid],
) -> Result<(), crate::error::AppError> {
    if concept_ids.is_empty() {
        return Err(crate::error::AppError::invalid_input(
            "conceptIds must be non-empty.",
        ));
    }
    let rows = sqlx::query_scalar::<_, Uuid>(&format!(
        r#"
        SELECT c.id
        FROM {} c
        WHERE c.id = ANY($1)
          AND (
            c.course_id = $2
            OR EXISTS (
                SELECT 1
                FROM course.concept_question_tags t
                INNER JOIN course.questions q ON q.id = t.question_id
                WHERE t.concept_id = c.id AND q.course_id = $2
            )
          )
        "#,
        crate::db::schema::CONCEPTS
    ))
    .bind(concept_ids)
    .bind(course_id)
    .fetch_all(pool)
    .await
    .map_err(crate::error::AppError::Db)?;
    if rows.len() != concept_ids.len() {
        return Err(crate::error::AppError::invalid_input(
            "One or more conceptIds are unknown or not usable in this course.",
        ));
    }
    Ok(())
}

pub fn validate_rule_type(rt: &str) -> Result<(), crate::error::AppError> {
    match rt {
        "skip_if_mastered"
        | "required_if_not_mastered"
        | "unlock_after"
        | "remediation_insert" => Ok(()),
        _ => Err(crate::error::AppError::invalid_input(
            "ruleType must be skip_if_mastered, required_if_not_mastered, unlock_after, or remediation_insert.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::adaptive_path::StructurePathRuleRow;
    use chrono::Utc;
    use uuid::Uuid;

    fn sample_rows() -> Vec<CourseStructureItemRow> {
        let course = Uuid::nil();
        let m1 = Uuid::new_v4();
        let q1 = Uuid::new_v4();
        let q2 = Uuid::new_v4();
        vec![
            CourseStructureItemRow {
                id: m1,
                course_id: course,
                sort_order: 0,
                kind: "module".into(),
                title: "M1".into(),
                parent_id: None,
                published: true,
                visible_from: None,
                archived: false,
                due_at: None,
                assignment_group_id: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            CourseStructureItemRow {
                id: q1,
                course_id: course,
                sort_order: 0,
                kind: "quiz".into(),
                title: "Q1".into(),
                parent_id: Some(m1),
                published: true,
                visible_from: None,
                archived: false,
                due_at: None,
                assignment_group_id: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            CourseStructureItemRow {
                id: q2,
                course_id: course,
                sort_order: 1,
                kind: "quiz".into(),
                title: "Q2".into(),
                parent_id: Some(m1),
                published: true,
                visible_from: None,
                archived: false,
                due_at: None,
                assignment_group_id: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        ]
    }

    fn rule_skip(host: Uuid, concept: Uuid, th: f64, target: Option<Uuid>) -> StructurePathRuleRow {
        StructurePathRuleRow {
            id: Uuid::new_v4(),
            structure_item_id: host,
            rule_type: "skip_if_mastered".into(),
            concept_ids: vec![concept],
            threshold: th,
            target_item_id: target,
            priority: 0,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn skip_if_mastered_skips_quiz_when_threshold_met() {
        let rows = sample_rows();
        let q1 = rows[1].id;
        let q2 = rows[2].id;
        let concept = Uuid::new_v4();
        let mut mastery = HashMap::new();
        mastery.insert(concept, 0.9);
        let rules = vec![rule_skip(q1, concept, 0.8, None)];
        let res = resolve_next_item(&rows, None, &mastery, &rules, None, true, false).unwrap();
        assert_eq!(res.to_item_id, q2);
        assert!(res.skip_reason_key.is_some());
    }

    #[test]
    fn mastery_failed_falls_back_linear() {
        let rows = sample_rows();
        let q1 = rows[1].id;
        let concept = Uuid::new_v4();
        let rules = vec![rule_skip(q1, concept, 0.8, None)];
        let res =
            resolve_next_item(&rows, None, &HashMap::new(), &rules, None, true, true).unwrap();
        assert_eq!(res.to_item_id, q1);
        assert!(res.fallback);
    }

    #[test]
    fn override_sequence_bypasses_rules() {
        let rows = sample_rows();
        let q1 = rows[1].id;
        let q2 = rows[2].id;
        let concept = Uuid::new_v4();
        let mut mastery = HashMap::new();
        mastery.insert(concept, 0.99);
        let rules = vec![rule_skip(q1, concept, 0.5, None)];
        let seq = vec![q2, q1];
        let res =
            resolve_next_item(&rows, None, &mastery, &rules, Some(&seq), true, false).unwrap();
        assert_eq!(res.to_item_id, q2);
    }
}
