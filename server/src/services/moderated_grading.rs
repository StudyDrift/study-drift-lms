//! Moderated grading helpers (plan 3.4).

/// True when the spread between the highest and lowest provisional score exceeds `threshold_pct`
/// of the assignment's point scale.
pub fn provisional_scores_exceed_threshold(
    min_score: f64,
    max_score: f64,
    points_worth: Option<i32>,
    threshold_pct: i32,
) -> bool {
    let pw = points_worth.unwrap_or(100).max(1) as f64;
    let th = threshold_pct.clamp(0, 100) as f64;
    max_score - min_score > (pw * th / 100.0) + 1e-9
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_15_percent_of_100_points() {
        assert!(!provisional_scores_exceed_threshold(70.0, 84.0, Some(100), 15));
        assert!(provisional_scores_exceed_threshold(70.0, 90.0, Some(100), 15));
    }
}
