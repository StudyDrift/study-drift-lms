//! Excused grade state (plan 3.12) — parse CSV cells and document intent.

/// Returns `true` for values that mark a grade as excused (EX, excused, 1).
/// Case-insensitive; trims whitespace and leading apostrophe.
pub fn parse_csv_excuse_token(raw: &str) -> bool {
    let t = trim_cell(raw);
    if t.is_empty() {
        return false;
    }
    let u = t.to_ascii_lowercase();
    u == "ex" || u == "excused" || u == "1" || u == "true" || u == "yes" || u == "y"
}

fn trim_cell(raw: &str) -> String {
    let t = raw.trim();
    t.strip_prefix('\'').unwrap_or(t).trim().to_string()
}

/// `None` = no change. `Some(true/false)` = set or clear (3.12 CSV "excuse" column).
pub fn parse_csv_excuse_cell(raw: &str) -> Option<bool> {
    let t = trim_cell(raw);
    if t.is_empty() {
        return None;
    }
    let u = t.to_ascii_lowercase();
    if u == "ex" || u == "excused" || u == "1" || u == "true" || u == "yes" || u == "y" {
        return Some(true);
    }
    if u == "0" || u == "no" || u == "false" || u == "n" {
        return Some(false);
    }
    None
}
