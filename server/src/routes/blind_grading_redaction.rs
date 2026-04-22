//! Plan 3.3 — server-side submission redaction for blind grading (testable helpers).

use std::collections::HashMap;
use uuid::Uuid;

use crate::repos::module_assignment_submissions::SubmissionRow;

/// English default; clients may localize using `blind_label` as fallback text.
pub fn blind_student_label(rank_one_indexed: usize) -> String {
    format!("Student {}", rank_one_indexed)
}

pub fn submission_rank_by_id(submissions_newest_first_order: &[SubmissionRow]) -> HashMap<Uuid, usize> {
    submissions_newest_first_order
        .iter()
        .enumerate()
        .map(|(i, r)| (r.id, i + 1))
        .collect()
}

/// Staff viewing submissions while blind grading is active and identities are not yet revealed.
#[inline]
pub fn should_redact_submission_pii_for_staff(
    feature_enabled: bool,
    blind_grading: bool,
    identities_revealed_at: bool,
) -> bool {
    feature_enabled && blind_grading && !identities_revealed_at
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blind_student_label_formats() {
        assert_eq!(blind_student_label(1), "Student 1");
        assert_eq!(blind_student_label(12), "Student 12");
    }

    #[test]
    fn should_redact_matrix() {
        assert!(!should_redact_submission_pii_for_staff(false, true, false));
        assert!(!should_redact_submission_pii_for_staff(true, false, false));
        assert!(!should_redact_submission_pii_for_staff(true, true, true));
        assert!(should_redact_submission_pii_for_staff(true, true, false));
    }
}
