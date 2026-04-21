//! Pure SM-2 scheduling (SuperMemo 2). FSRS can plug in behind the same inputs later.

/// SM-2 quality score 0–5 (mapped from learner grades in `grade_to_quality`).
pub type Quality = f64;

#[derive(Debug, Clone, PartialEq)]
pub struct Sm2State {
    pub easiness_factor: f64,
    pub repetition: i32,
    pub interval_days: f64,
}

impl Default for Sm2State {
    fn default() -> Self {
        Self {
            easiness_factor: 2.5,
            repetition: 0,
            interval_days: 0.0,
        }
    }
}

/// Maps UI grades to SM-2 quality (0 = complete failure … 5 = perfect).
pub fn grade_to_quality(grade: &str) -> Option<Quality> {
    match grade.trim().to_ascii_lowercase().as_str() {
        "again" => Some(0.0),
        "hard" => Some(2.0),
        "good" => Some(4.0),
        "easy" => Some(5.0),
        _ => None,
    }
}

/// One SM-2 step: updates EF, repetition count, and interval (days).
pub fn sm2_step(prev: &Sm2State, quality: Quality) -> Sm2State {
    let q = quality.clamp(0.0, 5.0);
    let mut ef = prev.easiness_factor.max(1.3);
    let mut repetition = prev.repetition;

    if q < 3.0 {
        repetition = 0;
        return Sm2State {
            easiness_factor: ef,
            repetition,
            interval_days: 1.0,
        };
    }

    let ef_delta = 0.1 - (5.0 - q) * (0.08 + (5.0 - q) * 0.02);
    ef = (ef + ef_delta).max(1.3);

    let interval_days = if repetition == 0 {
        1.0
    } else if repetition == 1 {
        6.0
    } else {
        (prev.interval_days * ef).round().max(1.0)
    };
    repetition += 1;

    Sm2State {
        easiness_factor: ef,
        repetition,
        interval_days,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_good_sets_one_day() {
        let s0 = Sm2State::default();
        let s1 = sm2_step(&s0, 4.0);
        assert!((s1.interval_days - 1.0).abs() < 1e-9);
        assert_eq!(s1.repetition, 1);
        assert!((s1.easiness_factor - 2.5).abs() < 1e-9);
    }

    #[test]
    fn second_good_sets_six_days() {
        let s0 = Sm2State::default();
        let s1 = sm2_step(&s0, 4.0);
        let s2 = sm2_step(&s1, 4.0);
        assert!((s2.interval_days - 6.0).abs() < 1e-9);
        assert_eq!(s2.repetition, 2);
        assert!(s2.easiness_factor >= 2.5);
    }

    #[test]
    fn again_resets() {
        let s0 = Sm2State {
            easiness_factor: 2.6,
            repetition: 2,
            interval_days: 10.0,
        };
        let s1 = sm2_step(&s0, 0.0);
        assert_eq!(s1.repetition, 0);
        assert!((s1.interval_days - 1.0).abs() < 1e-9);
    }

    #[test]
    fn ef_floor() {
        let s0 = Sm2State {
            easiness_factor: 1.3,
            repetition: 5,
            interval_days: 20.0,
        };
        let s1 = sm2_step(&s0, 5.0);
        assert!(s1.easiness_factor >= 1.3);
    }
}
