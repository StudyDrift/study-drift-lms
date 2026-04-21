//! Pure helpers for per-attempt quiz ordering (question shuffle, option permutation).

use rand::seq::SliceRandom;
use rand::Rng;

use crate::models::course_module_quiz::QuizQuestion;

/// Returns a uniform random permutation of `0..n` using Fisher–Yates (`n` must be > 0).
pub fn shuffle_indices<R: Rng + ?Sized>(n: usize, rng: &mut R) -> Vec<usize> {
    debug_assert!(n > 0);
    let mut v: Vec<usize> = (0..n).collect();
    v.shuffle(rng);
    v
}

/// `perm[k]` is the **authored** choice index shown at **display** position `k`.
pub fn apply_choice_display_order(mut q: QuizQuestion, perm: &[usize]) -> QuizQuestion {
    if perm.is_empty() || perm.len() != q.choices.len() {
        return q;
    }
    let n = q.choices.len();
    let mut seen = vec![false; n];
    for &p in perm {
        if p >= n || seen[p] {
            return q;
        }
        seen[p] = true;
    }

    let old_choices = std::mem::take(&mut q.choices);
    q.choices = perm.iter().map(|&i| old_choices[i].clone()).collect();

    if !q.choice_ids.is_empty() && q.choice_ids.len() == old_choices.len() {
        let old_ids = std::mem::take(&mut q.choice_ids);
        q.choice_ids = perm.iter().map(|&i| old_ids[i].clone()).collect();
    }

    if let Some(ci) = q.correct_choice_index {
        if let Some(new_idx) = perm.iter().position(|&authored| authored == ci) {
            q.correct_choice_index = Some(new_idx);
        }
    }
    q
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn shuffle_indices_deterministic_with_seed() {
        let mut r1 = StdRng::seed_from_u64(42);
        let mut r2 = StdRng::seed_from_u64(42);
        assert_eq!(shuffle_indices(5, &mut r1), shuffle_indices(5, &mut r2));
    }

    #[test]
    fn apply_choice_display_order_remaps_correct_index() {
        let q = QuizQuestion {
            id: "x".into(),
            prompt: "p".into(),
            question_type: "multiple_choice".into(),
            choices: vec!["A".into(), "B".into(), "C".into()],
            choice_ids: vec![],
            type_config: serde_json::json!({}),
            correct_choice_index: Some(1),
            multiple_answer: false,
            answer_with_image: false,
            required: true,
            points: 1,
            estimated_minutes: 2,
            concept_ids: vec![],
            srs_eligible: false,
        };
        // Display order: C, A, B  => perm [2,0,1]
        let out = apply_choice_display_order(q, &[2, 0, 1]);
        assert_eq!(out.choices, vec!["C", "A", "B"]);
        assert_eq!(out.correct_choice_index, Some(2));
    }
}
