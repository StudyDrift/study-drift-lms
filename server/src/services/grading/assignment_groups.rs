//! Assignment-group drop / replace policy (plan 3.9).

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::models::course_grading::AssignmentGroupPublic;

/// One gradable line item in a group for drop math.
#[derive(Debug, Clone)]
pub struct GroupScoreLine {
    pub item_id: Uuid,
    pub max_points: f64,
    pub earned_points: f64,
    pub never_drop: bool,
    /// Designates the “final” column for replace-lowest policy.
    pub replace_with_final: bool,
    /// Plan 3.12 — excluded from group pools, drop math, and effective totals.
    pub excused: bool,
}

/// Config from `assignment_groups` row.
#[derive(Debug, Clone, Copy)]
pub struct GroupDropPolicy {
    pub drop_lowest: i32,
    pub drop_highest: i32,
    pub replace_lowest_with_final: bool,
}

/// Result of applying group policy: effective totals and which items are dropped.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupAverageWithDrops {
    /// Sum of max points for items that count toward the group.
    pub effective_max: f64,
    /// Sum of earned points (after replace-lowest) for counting items.
    pub effective_earned: f64,
    /// Item ids whose scores are excluded by drop rules (still “shown” in UI).
    pub dropped: HashSet<Uuid>,
}

/// Computes effective earned/max and dropped item ids for one student in one assignment group.
pub fn compute_group_average_with_drops(
    policy: &GroupDropPolicy,
    lines: &[GroupScoreLine],
) -> GroupAverageWithDrops {
    if lines.is_empty() {
        return GroupAverageWithDrops {
            effective_max: 0.0,
            effective_earned: 0.0,
            dropped: HashSet::new(),
        };
    }

    #[derive(Debug, Clone)]
    struct Scored {
        id: Uuid,
        max: f64,
        earned: f64,
        pct: f64,
        can_drop: bool,
        is_final: bool,
    }

    let mut rows: Vec<Scored> = lines
        .iter()
        .filter(|l| !l.excused)
        .map(|l| {
            let max = if l.max_points > 0.0 && l.max_points.is_finite() {
                l.max_points
            } else {
                0.0
            };
            let earned = l.earned_points.max(0.0);
            let pct = if max > 0.0 { earned / max } else { 0.0 };
            let is_final = l.replace_with_final;
            let can_drop = !l.never_drop && !is_final;
            Scored {
                id: l.item_id,
                max,
                earned,
                pct: if pct.is_finite() { pct } else { 0.0 },
                can_drop,
                is_final,
            }
        })
        .filter(|r| r.max > 0.0)
        .collect();

    rows.sort_by(|a, b| {
        a.pct
            .partial_cmp(&b.pct)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut work: Vec<Scored> = rows.iter().filter(|r| r.can_drop).cloned().collect();
    let mut dropped: HashSet<Uuid> = HashSet::new();

    let n_low = policy.drop_lowest.max(0) as usize;
    let n_high = policy.drop_highest.max(0) as usize;

    for _ in 0..n_low {
        if work.is_empty() {
            break;
        }
        dropped.insert(work.remove(0).id);
    }
    for _ in 0..n_high {
        if work.is_empty() {
            break;
        }
        dropped.insert(work.remove(work.len() - 1).id);
    }

    let mut effective_max: f64 = 0.0;
    let mut effective_earned: f64 = 0.0;
    for r in &rows {
        if dropped.contains(&r.id) {
            continue;
        }
        effective_max += r.max;
        effective_earned += r.earned;
    }

    if policy.replace_lowest_with_final {
        let final_row = rows.iter().find(|r| r.is_final && !dropped.contains(&r.id));
        if let Some(f) = final_row {
            let f_pct = f.pct;
            if f_pct > 0.0 {
                if let Some(t) = rows
                    .iter()
                    .filter(|r| !r.is_final && !dropped.contains(&r.id))
                    .min_by(|a, b| {
                        a.pct
                            .partial_cmp(&b.pct)
                            .unwrap_or(std::cmp::Ordering::Equal)
                            .then_with(|| a.id.cmp(&b.id))
                    })
                {
                    if f_pct > t.pct + 1e-12 {
                        effective_earned -= t.earned;
                        effective_earned += t.max * f_pct;
                    }
                }
            }
        }
    }

    GroupAverageWithDrops {
        effective_max,
        effective_earned,
        dropped,
    }
}

/// Per-item `dropped` for one learner given parsed earned points and gradebook columns in group order.
pub fn item_drops_for_learner(
    group_policies: &HashMap<Uuid, GroupDropPolicy>,
    col_meta: &[(Uuid, Option<Uuid>, f64, bool, bool)], // id, group_id, max, never_drop, is_final
    earned_by_item: &HashMap<Uuid, f64>,
    excused_by_item: &HashMap<Uuid, bool>,
) -> HashMap<Uuid, bool> {
    let mut by_group: HashMap<Uuid, Vec<GroupScoreLine>> = HashMap::new();
    for (id, gid, max, never_drop, is_final) in col_meta {
        if *max <= 0.0 {
            continue;
        }
        let g = *gid;
        if g.is_none() {
            continue;
        }
        if excused_by_item.get(id).copied().unwrap_or(false) {
            continue;
        }
        let e = earned_by_item.get(id).copied().unwrap_or(0.0);
        let line = GroupScoreLine {
            item_id: *id,
            max_points: *max,
            earned_points: e,
            never_drop: *never_drop,
            replace_with_final: *is_final,
            excused: false,
        };
        by_group.entry(g.unwrap()).or_default().push(line);
    }
    let mut out: HashMap<Uuid, bool> = col_meta
        .iter()
        .map(|(id, ..)| (*id, false))
        .collect();
    for (gid, lines) in by_group {
        let Some(pol) = group_policies.get(&gid) else {
            continue;
        };
        let res = compute_group_average_with_drops(pol, &lines);
        for d in res.dropped {
            out.insert(d, true);
        }
    }
    out
}

/// One gradable column (assignment/quiz) for final % math — mirrors `compute-course-final-percent` (web).
#[derive(Debug, Clone)]
pub struct GradebookColumnForFinal {
    pub item_id: Uuid,
    pub max_points: f64,
    pub assignment_group_id: Option<Uuid>,
    pub never_drop: bool,
    pub replace_with_final: bool,
}

const UNGROUPED: &str = "__ungrouped__";

/// Course final as a percentage 0–100, with assignment-group weights and drops (plan 3.9).
/// Port of `computeCourseFinalPercent` in `compute-course-final-percent.ts`.
pub fn compute_course_final_percent(
    columns: &[GradebookColumnForFinal],
    earned_by_item: &HashMap<Uuid, f64>,
    excused_by_item: &HashMap<Uuid, bool>,
    assignment_groups: &[AssignmentGroupPublic],
) -> Option<f64> {
    let settings_ids: HashSet<Uuid> = assignment_groups.iter().map(|g| g.id).collect();
    let gpol: HashMap<Uuid, GroupDropPolicy> = assignment_groups
        .iter()
        .map(|g| {
            (
                g.id,
                GroupDropPolicy {
                    drop_lowest: g.drop_lowest.max(0),
                    drop_highest: g.drop_highest.max(0),
                    replace_lowest_with_final: g.replace_lowest_with_final,
                },
            )
        })
        .collect();

    let mut max_by_bucket: HashMap<String, f64> = HashMap::new();
    let mut earned_by_bucket: HashMap<String, f64> = HashMap::new();
    let mut by_group: HashMap<Uuid, Vec<GroupScoreLine>> = HashMap::new();

    for col in columns {
        if col.max_points <= 0.0 || !col.max_points.is_finite() {
            continue;
        }
        if excused_by_item
            .get(&col.item_id)
            .copied()
            .unwrap_or(false)
        {
            continue;
        }
        let earned = earned_by_item
            .get(&col.item_id)
            .copied()
            .filter(|e| e.is_finite())
            .map(|e| e.max(0.0))
            .unwrap_or(0.0);
        match col.assignment_group_id {
            Some(g) if settings_ids.contains(&g) => {
                by_group.entry(g).or_default().push(GroupScoreLine {
                    item_id: col.item_id,
                    max_points: col.max_points,
                    earned_points: earned,
                    never_drop: col.never_drop,
                    replace_with_final: col.replace_with_final,
                    excused: false,
                });
            }
            _ => {
                *max_by_bucket
                    .entry(UNGROUPED.to_string())
                    .or_insert(0.0) += col.max_points;
                *earned_by_bucket
                    .entry(UNGROUPED.to_string())
                    .or_insert(0.0) += earned;
            }
        }
    }

    for (gid, lines) in by_group {
        let pol = gpol.get(&gid).copied().unwrap_or(GroupDropPolicy {
            drop_lowest: 0,
            drop_highest: 0,
            replace_lowest_with_final: false,
        });
        let r = compute_group_average_with_drops(&pol, &lines);
        let b = gid.to_string();
        *max_by_bucket.entry(b.clone()).or_insert(0.0) += r.effective_max;
        *earned_by_bucket.entry(b).or_insert(0.0) += r.effective_earned;
    }

    let total_max_points: f64 = max_by_bucket.values().sum();
    if total_max_points <= 0.0 {
        return None;
    }

    let buckets_with_columns: HashSet<String> = max_by_bucket
        .iter()
        .filter(|(_, mx)| **mx > 0.0)
        .map(|(k, _)| k.clone())
        .collect();
    if buckets_with_columns.is_empty() {
        return None;
    }

    let configured_sum: f64 = assignment_groups
        .iter()
        .map(|g| {
            if g.weight_percent.is_finite() && g.weight_percent > 0.0 {
                g.weight_percent
            } else {
                0.0
            }
        })
        .sum();
    let remainder = (100.0 - configured_sum).max(0.0);

    let mut lost_configured_weight = 0.0;
    for g in assignment_groups {
        let w = if g.weight_percent.is_finite() && g.weight_percent > 0.0 {
            g.weight_percent
        } else {
            0.0
        };
        if w <= 0.0 {
            continue;
        }
        if !buckets_with_columns.contains(&g.id.to_string()) {
            lost_configured_weight += w;
        }
    }

    let max_ungrouped = max_by_bucket.get(UNGROUPED).copied().unwrap_or(0.0);
    let mut raw_weight: HashMap<String, f64> = HashMap::new();
    for g in assignment_groups {
        if !buckets_with_columns.contains(&g.id.to_string()) {
            continue;
        }
        let w = if g.weight_percent.is_finite() && g.weight_percent > 0.0 {
            g.weight_percent
        } else {
            0.0
        };
        if w > 0.0 {
            *raw_weight.entry(g.id.to_string()).or_insert(0.0) += w;
        }
    }
    if buckets_with_columns.contains(UNGROUPED) {
        let mut wu = remainder + lost_configured_weight;
        if wu <= 0.0 && max_ungrouped > 0.0 && total_max_points > 0.0 {
            wu = (max_ungrouped / total_max_points) * 100.0;
        }
        *raw_weight.entry(UNGROUPED.to_string()).or_insert(0.0) += wu;
    }

    let weight_sum: f64 = raw_weight.values().sum();
    if weight_sum <= 0.0 {
        let earned_total: f64 = earned_by_bucket.values().sum();
        return Some((earned_total / total_max_points) * 100.0);
    }

    let mut acc = 0.0;
    for (bucket, rw) in &raw_weight {
        if *rw <= 0.0 {
            continue;
        }
        let max_b = max_by_bucket.get(bucket).copied().unwrap_or(0.0);
        let earned_b = earned_by_bucket.get(bucket).copied().unwrap_or(0.0);
        let ratio = if max_b > 0.0 { earned_b / max_b } else { 0.0 };
        acc += ratio * (rw / weight_sum);
    }
    Some(acc * 100.0)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn line_ex(
        n: u128,
        max: f64,
        earned: f64,
        never_drop: bool,
        is_final: bool,
        excused: bool,
    ) -> GroupScoreLine {
        GroupScoreLine {
            item_id: id(n),
            max_points: max,
            earned_points: earned,
            never_drop,
            replace_with_final: is_final,
            excused,
        }
    }

    fn line(
        n: u128,
        max: f64,
        earned: f64,
        never_drop: bool,
        is_final: bool,
    ) -> GroupScoreLine {
        line_ex(n, max, earned, never_drop, is_final, false)
    }

    #[test]
    fn ac1_drop_one_lowest() {
        // [60,70,80,90] on 100-pt line items => drop 60, mean of rest: (70+80+90)/3 = 80% of the kept pool.
        let g = [
            line(1, 100.0, 60.0, false, false),
            line(2, 100.0, 70.0, false, false),
            line(3, 100.0, 80.0, false, false),
            line(4, 100.0, 90.0, false, false),
        ];
        let pol = GroupDropPolicy {
            drop_lowest: 1,
            drop_highest: 0,
            replace_lowest_with_final: false,
        };
        let r = compute_group_average_with_drops(&pol, &g);
        assert!(r.dropped.contains(&id(1)));
        assert_eq!(r.effective_max, 300.0);
        assert!((r.effective_earned - 240.0).abs() < 1e-6);
    }

    #[test]
    fn ac2_never_drop_lowest_not_dropped() {
        // Lowest (60) on item 1 has never_drop; drop next lowest (70 on item 2)
        let g = [
            line(1, 100.0, 60.0, true, false),
            line(2, 100.0, 70.0, false, false),
            line(3, 100.0, 80.0, false, false),
            line(4, 100.0, 90.0, false, false),
        ];
        let pol = GroupDropPolicy {
            drop_lowest: 1,
            drop_highest: 0,
            replace_lowest_with_final: false,
        };
        let r = compute_group_average_with_drops(&pol, &g);
        assert!(r.dropped.contains(&id(2)));
        assert!(!r.dropped.contains(&id(1)));
    }

    #[test]
    fn ac3_drop_more_than_count_all_gone() {
        let g = [line(1, 100.0, 50.0, false, false), line(2, 100.0, 60.0, false, false)];
        let pol = GroupDropPolicy {
            drop_lowest: 3,
            drop_highest: 0,
            replace_lowest_with_final: false,
        };
        let r = compute_group_average_with_drops(&pol, &g);
        assert_eq!(r.dropped.len(), 2);
        assert!((r.effective_earned - 0.0).abs() < 1e-9);
        assert!((r.effective_max - 0.0).abs() < 1e-9);
    }

    #[test]
    fn ac_excused_excluded_from_drop() {
        // 3.12 / 3.9: excused 60 not in pool — drop 50 from {50, EX, 80, 90}
        let g = [
            line_ex(1, 100.0, 50.0, false, false, false),
            line_ex(2, 100.0, 60.0, false, false, true),
            line_ex(3, 100.0, 80.0, false, false, false),
            line_ex(4, 100.0, 90.0, false, false, false),
        ];
        let pol = GroupDropPolicy {
            drop_lowest: 1,
            drop_highest: 0,
            replace_lowest_with_final: false,
        };
        let r = compute_group_average_with_drops(&pol, &g);
        assert!(r.dropped.contains(&id(1)));
        assert!((r.effective_earned - 170.0).abs() < 1e-6);
        assert!((r.effective_max - 200.0).abs() < 1e-6);
    }

    #[test]
    fn replace_with_final() {
        let g = [
            line(1, 100.0, 50.0, false, false),
            line(2, 100.0, 70.0, false, false),
            line(3, 100.0, 90.0, false, true),
        ];
        let pol = GroupDropPolicy {
            drop_lowest: 0,
            drop_highest: 0,
            replace_lowest_with_final: true,
        };
        let r = compute_group_average_with_drops(&pol, &g);
        // Replace 50% with 90% on the 100-pt item => 90 + 70 + 90 = 250
        assert!((r.effective_earned - 250.0).abs() < 1e-6);
        assert!((r.effective_max - 300.0).abs() < 1e-6);
    }

    #[test]
    fn final_percent_straight_points() {
        let a = id(0xa);
        let b = id(0xb);
        let p = compute_course_final_percent(
            &[
                GradebookColumnForFinal {
                    item_id: a,
                    max_points: 100.0,
                    assignment_group_id: None,
                    never_drop: false,
                    replace_with_final: false,
                },
                GradebookColumnForFinal {
                    item_id: b,
                    max_points: 50.0,
                    assignment_group_id: None,
                    never_drop: false,
                    replace_with_final: false,
                },
            ],
            &HashMap::from([(a, 80.0), (b, 40.0)]),
            &HashMap::new(),
            &[],
        );
        assert!((p.unwrap() - (120.0 / 150.0) * 100.0).abs() < 1e-4);
    }

    #[test]
    fn final_percent_weighted_group() {
        let g1 = id(0x1);
        let a = id(0xa);
        let b = id(0xb);
        let p = compute_course_final_percent(
            &[
                GradebookColumnForFinal {
                    item_id: a,
                    max_points: 100.0,
                    assignment_group_id: Some(g1),
                    never_drop: false,
                    replace_with_final: false,
                },
                GradebookColumnForFinal {
                    item_id: b,
                    max_points: 100.0,
                    assignment_group_id: Some(g1),
                    never_drop: false,
                    replace_with_final: false,
                },
            ],
            &HashMap::from([(a, 40.0), (b, 30.0)]),
            &HashMap::new(),
            &[AssignmentGroupPublic {
                id: g1,
                sort_order: 0,
                name: "g".into(),
                weight_percent: 100.0,
                drop_lowest: 0,
                drop_highest: 0,
                replace_lowest_with_final: false,
            }],
        );
        assert!((p.unwrap() - 35.0).abs() < 1e-4);
    }
}
