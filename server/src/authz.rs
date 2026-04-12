//! Permission string matching (`scope:area:function:action`).
//! A segment matches if either side is `*`, or both are equal.

/// Returns true when `granted` authorizes `required` (both must be four `:`-separated segments).
pub fn permission_matches(granted: &str, required: &str) -> bool {
    let g_parts: Vec<&str> = granted.trim().split(':').collect();
    let r_parts: Vec<&str> = required.trim().split(':').collect();
    if g_parts.len() != 4 || r_parts.len() != 4 {
        return false;
    }
    for i in 0..4 {
        if !segment_matches(g_parts[i], r_parts[i]) {
            return false;
        }
    }
    true
}

fn segment_matches(g: &str, r: &str) -> bool {
    g == "*" || r == "*" || g == r
}

/// True if any grant matches `required`.
pub fn any_grant_matches(grants: &[String], required: &str) -> bool {
    grants.iter().any(|g| permission_matches(g, required))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_four_part_match() {
        assert!(permission_matches(
            "course:C-6F8192:enrollments:create",
            "course:C-6F8192:enrollments:create"
        ));
    }

    #[test]
    fn wildcard_in_granted_course() {
        assert!(permission_matches(
            "course:*:enrollments:create",
            "course:C-6F8192:enrollments:create"
        ));
    }

    #[test]
    fn wildcard_in_required_course() {
        assert!(permission_matches(
            "course:C-6F8192:enrollments:create",
            "course:*:enrollments:create"
        ));
    }

    #[test]
    fn broad_granted_matches_narrow_required() {
        assert!(permission_matches(
            "course:*:enrollments:*",
            "course:C-6F8192:enrollments:create"
        ));
    }

    #[test]
    fn mismatch_on_action() {
        assert!(!permission_matches(
            "course:*:enrollments:read",
            "course:*:enrollments:create"
        ));
    }

    #[test]
    fn wrong_segment_count() {
        assert!(!permission_matches(
            "course:enrollments:create",
            "course:a:b:create"
        ));
    }

    #[test]
    fn any_grant_matches_finds_one() {
        let g = vec![
            "global:app:other:read".to_string(),
            "course:*:enrollments:create".to_string(),
        ];
        assert!(any_grant_matches(&g, "course:C-1:enrollments:create"));
        assert!(!any_grant_matches(&g, "course:C-1:enrollments:delete"));
    }
}
