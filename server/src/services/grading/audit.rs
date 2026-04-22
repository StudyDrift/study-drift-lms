//! Grade-change audit (plan 3.10) — all mutations go through `repos::grade_audit_events` in
//! the same database transaction. Use [`crate::repos::grade_audit_events::grade_cell_id`]
//! for a stable per-cell id.

pub use crate::repos::grade_audit_events::grade_cell_id;
