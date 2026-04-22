//! Assignment-group drop / replace policy (plan 3.9).

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

/// One gradable line item in a group for drop math.
#[derive(Debug, Clone)]
pub struct GroupScoreLine {
    pub item_id: Uuid,
    pub max_points: f64,
    pub earned_points: f64,
    pub never_drop: bool,
    /// Designates the “final” column for replace-lowest policy.
    pub replace_with_final: bool,
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
        let e = earned_by_item.get(id).copied().unwrap_or(0.0);
        let line = GroupScoreLine {
            item_id: *id,
            max_points: *max,
            earned_points: e,
            never_drop: *never_drop,
            replace_with_final: *is_final,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn line(
        n: u128,
        max: f64,
        earned: f64,
        never_drop: bool,
        is_final: bool,
    ) -> GroupScoreLine {
        GroupScoreLine {
            item_id: id(n),
            max_points: max,
            earned_points: earned,
            never_drop,
            replace_with_final: is_final,
        }
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
}
