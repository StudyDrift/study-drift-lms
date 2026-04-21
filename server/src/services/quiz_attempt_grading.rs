//! Scoring helpers for stored quiz attempts.

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::models::course_module_quiz::{
    AdaptiveQuizHistoryTurn, QuizQuestion, QuizQuestionResponseItem,
};
use crate::repos::quiz_attempts::QuizAttemptRow;
use crate::services::relative_schedule::{shift_opt, RelativeShiftContext};

pub fn adaptive_turn_is_correct(turn: &AdaptiveQuizHistoryTurn) -> bool {
    let weights = &turn.choice_weights;
    if weights.is_empty() {
        return false;
    }
    let Some(sel) = turn.selected_choice_index else {
        return false;
    };
    if sel >= weights.len() {
        return false;
    }
    let max_w = weights.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    if !max_w.is_finite() {
        return false;
    }
    let w = weights[sel];
    (w - max_w).abs() < 1e-9 || w >= max_w - 1e-9
}

pub fn adaptive_turn_max_points(turn: &AdaptiveQuizHistoryTurn) -> f64 {
    let p = turn.points.unwrap_or(1);
    if p < 0 {
        return 0.0;
    }
    p as f64
}

/// Returns (points_awarded, max_points, is_correct).
pub fn grade_static_question(
    q: &QuizQuestion,
    resp: &QuizQuestionResponseItem,
) -> (f64, f64, Option<bool>) {
    let max = if q.points < 0 { 0.0 } else { q.points as f64 };
    match q.question_type.as_str() {
        "multiple_choice" | "true_false" => {
            let Some(sel) = resp.selected_choice_index else {
                return (0.0, max, Some(false));
            };
            let Some(correct) = q.correct_choice_index else {
                return (0.0, max, None);
            };
            let ok = sel == correct;
            let pts = if ok { max } else { 0.0 };
            (pts, max, Some(ok))
        }
        "fill_in_blank" | "short_answer" | "essay" => (0.0, max, None),
        "numeric" => {
            let Some(value) = resp.numeric_value else {
                return (0.0, max, Some(false));
            };
            let Some(correct) = q.type_config.get("correct").and_then(Value::as_f64) else {
                return (0.0, max, None);
            };
            let abs_tol = q
                .type_config
                .get("tolerance_abs")
                .or_else(|| q.type_config.get("toleranceAbs"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
                .max(0.0);
            let rel_tol = q
                .type_config
                .get("tolerance_pct")
                .or_else(|| q.type_config.get("tolerancePct"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
                .max(0.0);
            let tol_from_pct = correct.abs() * (rel_tol / 100.0);
            let tol = abs_tol.max(tol_from_pct);
            let ok = (value - correct).abs() <= tol;
            (if ok { max } else { 0.0 }, max, Some(ok))
        }
        "formula" => {
            let guess = resp.formula_latex.clone().unwrap_or_default();
            let target = q
                .type_config
                .get("latex_answer")
                .or_else(|| q.type_config.get("latexAnswer"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if target.is_empty() {
                return (0.0, max, None);
            }
            let guess_norm = normalize_formula(&guess);
            let mut ok = guess_norm == normalize_formula(target);
            if !ok {
                if let Some(eq) = q
                    .type_config
                    .get("equivalences")
                    .and_then(Value::as_array)
                    .or_else(|| {
                        q.type_config
                            .get("equivalenceList")
                            .and_then(Value::as_array)
                    })
                {
                    ok = eq
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|s| normalize_formula(s) == guess_norm);
                }
            }
            (if ok { max } else { 0.0 }, max, Some(ok))
        }
        "matching" => {
            let authored = q.type_config.get("pairs").and_then(Value::as_array);
            let Some(authored_pairs) = authored else {
                return (0.0, max, None);
            };
            if authored_pairs.is_empty() {
                return (0.0, max, None);
            }
            let selected = resp.matching_pairs.clone().unwrap_or_default();
            let mut correct = 0usize;
            for pair in authored_pairs {
                let left = pair
                    .get("left_id")
                    .or_else(|| pair.get("leftId"))
                    .and_then(Value::as_str);
                let right = pair
                    .get("right_id")
                    .or_else(|| pair.get("rightId"))
                    .and_then(Value::as_str);
                if let (Some(l), Some(r)) = (left, right) {
                    if selected.iter().any(|p| p.left_id == l && p.right_id == r) {
                        correct += 1;
                    }
                }
            }
            let ratio = correct as f64 / authored_pairs.len() as f64;
            let pts = (max * ratio).clamp(0.0, max);
            (pts, max, Some((ratio - 1.0).abs() < 1e-9))
        }
        "ordering" => {
            let authored = q
                .type_config
                .get("items")
                .and_then(Value::as_array)
                .map(|arr| arr.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                .unwrap_or_default();
            if authored.is_empty() {
                return (0.0, max, None);
            }
            let selected = resp.ordering_sequence.clone().unwrap_or_default();
            if selected.len() != authored.len() {
                return (0.0, max, Some(false));
            }
            let correct = authored
                .iter()
                .zip(selected.iter())
                .filter(|(a, b)| *a == b)
                .count();
            let ratio = correct as f64 / authored.len() as f64;
            let pts = (max * ratio).clamp(0.0, max);
            (pts, max, Some((ratio - 1.0).abs() < 1e-9))
        }
        "hotspot" => {
            let Some(click) = resp.hotspot_click.as_ref() else {
                return (0.0, max, Some(false));
            };
            let regions = q
                .type_config
                .get("regions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if regions.is_empty() {
                return (0.0, max, None);
            }
            let ok = regions.iter().any(|r| point_in_region(click.x, click.y, r));
            (if ok { max } else { 0.0 }, max, Some(ok))
        }
        _ => (0.0, max, None),
    }
}

fn normalize_formula(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

fn point_in_region(x: f64, y: f64, region: &Value) -> bool {
    let shape = region
        .get("shape")
        .and_then(Value::as_str)
        .unwrap_or("rect");
    if shape == "rect" {
        let x0 = region.get("x").and_then(Value::as_f64).unwrap_or(f64::NAN);
        let y0 = region.get("y").and_then(Value::as_f64).unwrap_or(f64::NAN);
        let w = region
            .get("width")
            .and_then(Value::as_f64)
            .unwrap_or(f64::NAN);
        let h = region
            .get("height")
            .and_then(Value::as_f64)
            .unwrap_or(f64::NAN);
        return x0.is_finite()
            && y0.is_finite()
            && w.is_finite()
            && h.is_finite()
            && x >= x0
            && x <= x0 + w
            && y >= y0
            && y <= y0 + h;
    }
    false
}

/// Effective due time for a learner (relative schedule shifts authored due dates).
pub fn quiz_effective_due_at(
    due_at: Option<DateTime<Utc>>,
    shift: Option<&RelativeShiftContext>,
) -> Option<DateTime<Utc>> {
    match shift {
        Some(ctx) => shift_opt(ctx, due_at),
        None => due_at,
    }
}

/// True when a due date is set and submission occurs strictly after it.
pub fn quiz_submission_is_late(due_at: Option<DateTime<Utc>>, submitted_at: DateTime<Utc>) -> bool {
    due_at.is_some_and(|d| submitted_at > d)
}

/// Applies a percentage penalty to gradebook-scaled points (e.g. 10% off → multiply by 0.9).
pub fn apply_late_penalty_to_gradebook_points(points: f64, late_penalty_percent: i32) -> f64 {
    if !points.is_finite() || points <= 0.0 {
        return points;
    }
    let p = late_penalty_percent.clamp(0, 100);
    let factor = (100 - p) as f64 / 100.0;
    (points * factor).max(0.0)
}

pub fn points_for_gradebook(raw_earned: f64, raw_possible: f64, points_worth: Option<i32>) -> f64 {
    if raw_possible <= 0.0 || !raw_earned.is_finite() || !raw_possible.is_finite() {
        return 0.0;
    }
    let ratio = (raw_earned / raw_possible).clamp(0.0, 1.0);
    match points_worth {
        Some(p) if p > 0 => p as f64 * ratio,
        Some(0) => 0.0,
        _ => raw_earned,
    }
}

/// Which submitted attempt score feeds the gradebook when multiple tries exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetakePolicy {
    Highest,
    Latest,
    First,
    Average,
}

impl RetakePolicy {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "highest" => Some(Self::Highest),
            "latest" => Some(Self::Latest),
            "first" => Some(Self::First),
            "average" => Some(Self::Average),
            _ => None,
        }
    }
}

pub fn pick_policy_points(attempts: &[QuizAttemptRow], policy: &str) -> Option<(f64, f64)> {
    if attempts.is_empty() {
        return None;
    }
    let pick_row = match RetakePolicy::parse(policy) {
        Some(RetakePolicy::Highest) => attempts.iter().max_by(|a, b| {
            let ae = a.points_earned.unwrap_or(0.0);
            let be = b.points_earned.unwrap_or(0.0);
            ae.partial_cmp(&be).unwrap_or(std::cmp::Ordering::Equal)
        }),
        Some(RetakePolicy::First) => attempts.first(),
        Some(RetakePolicy::Latest) => attempts.last(),
        Some(RetakePolicy::Average) => {
            let n = attempts.len() as f64;
            let sum_e: f64 = attempts
                .iter()
                .map(|a| a.points_earned.unwrap_or(0.0))
                .sum();
            let sum_p: f64 = attempts
                .iter()
                .map(|a| a.points_possible.unwrap_or(0.0))
                .sum();
            return Some((sum_e / n, sum_p / n));
        }
        None => attempts.last(),
    };
    pick_row.map(|a| {
        (
            a.points_earned.unwrap_or(0.0),
            a.points_possible.unwrap_or(0.0),
        )
    })
}

/// Percent score (0–100) implied by policy-selected raw points, for reporting APIs.
pub fn policy_score_percent(earned: f64, possible: f64) -> Option<f64> {
    if possible <= 0.0 || !earned.is_finite() || !possible.is_finite() {
        return None;
    }
    Some(((earned / possible) * 100.0).clamp(0.0, 100.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn late_penalty_scales_points() {
        let out = apply_late_penalty_to_gradebook_points(100.0, 10);
        assert!((out - 90.0).abs() < 1e-9);
    }

    #[test]
    fn submission_not_late_before_or_at_due() {
        let due = Utc.with_ymd_and_hms(2026, 1, 2, 12, 0, 0).unwrap();
        assert!(!quiz_submission_is_late(Some(due), due));
        assert!(!quiz_submission_is_late(
            Some(due),
            due - chrono::Duration::seconds(1)
        ));
        assert!(quiz_submission_is_late(
            Some(due),
            due + chrono::Duration::seconds(1)
        ));
    }

    #[test]
    fn no_due_means_not_late() {
        assert!(!quiz_submission_is_late(None, Utc::now()));
    }

    fn sample_attempt_row(earned: f64, possible: f64) -> QuizAttemptRow {
        QuizAttemptRow {
            id: Uuid::nil(),
            course_id: Uuid::nil(),
            structure_item_id: Uuid::nil(),
            student_user_id: Uuid::nil(),
            attempt_number: 1,
            status: "submitted".into(),
            is_adaptive: false,
            started_at: Utc::now(),
            submitted_at: Some(Utc::now()),
            points_earned: Some(earned),
            points_possible: Some(possible),
            score_percent: None,
            adaptive_history_json: None,
            current_question_index: 0,
            academic_integrity_flag: false,
            deadline_at: None,
            extended_time_applied: false,
        }
    }

    #[test]
    fn retake_policy_highest_picks_max() {
        let attempts = vec![
            sample_attempt_row(60.0, 100.0),
            sample_attempt_row(80.0, 100.0),
        ];
        let (e, p) = pick_policy_points(&attempts, "highest").unwrap();
        assert!((e - 80.0).abs() < 1e-9 && (p - 100.0).abs() < 1e-9);
    }

    #[test]
    fn retake_policy_average_mean_score() {
        let attempts = vec![
            sample_attempt_row(60.0, 100.0),
            sample_attempt_row(80.0, 100.0),
        ];
        let (e, p) = pick_policy_points(&attempts, "average").unwrap();
        assert!((e - 70.0).abs() < 1e-9 && (p - 100.0).abs() < 1e-9);
        assert!((policy_score_percent(e, p).unwrap() - 70.0).abs() < 1e-9);
    }

    #[test]
    fn retake_policy_first_uses_earliest_submitted() {
        let mut a = sample_attempt_row(60.0, 100.0);
        let mut b = sample_attempt_row(80.0, 100.0);
        a.attempt_number = 1;
        b.attempt_number = 2;
        let attempts = vec![a, b];
        let (e, p) = pick_policy_points(&attempts, "first").unwrap();
        assert!((e - 60.0).abs() < 1e-9 && (p - 100.0).abs() < 1e-9);
    }
}
