//! Scoring helpers for stored quiz attempts.

use crate::models::course_module_quiz::{AdaptiveQuizHistoryTurn, QuizQuestion, QuizQuestionResponseItem};
use crate::repos::quiz_attempts::QuizAttemptRow;

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
    let max = if q.points < 0 {
        0.0
    } else {
        q.points as f64
    };
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
        _ => (0.0, max, None),
    }
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

pub fn pick_policy_points(attempts: &[QuizAttemptRow], policy: &str) -> Option<(f64, f64)> {
    if attempts.is_empty() {
        return None;
    }
    let p = policy.trim();
    match p {
        "highest" => attempts.iter().max_by(|a, b| {
            let ae = a.points_earned.unwrap_or(0.0);
            let be = b.points_earned.unwrap_or(0.0);
            ae.partial_cmp(&be).unwrap_or(std::cmp::Ordering::Equal)
        }),
        "first" => attempts.first(),
        "latest" => attempts.last(),
        "average" => {
            let n = attempts.len() as f64;
            let sum_e: f64 = attempts.iter().map(|a| a.points_earned.unwrap_or(0.0)).sum();
            let sum_p: f64 = attempts.iter().map(|a| a.points_possible.unwrap_or(0.0)).sum();
            return Some((sum_e / n, sum_p / n));
        }
        _ => attempts.last(),
    }
    .map(|a| {
        (
            a.points_earned.unwrap_or(0.0),
            a.points_possible.unwrap_or(0.0),
        )
    })
}
