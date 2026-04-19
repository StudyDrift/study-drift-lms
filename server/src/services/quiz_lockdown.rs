//! Effective lockdown delivery mode (plan 2.10) — depends on course feature flag + quiz row.

use crate::repos::course_module_quizzes::CourseItemQuizRow;

pub const LOCKDOWN_STANDARD: &str = "standard";
pub const LOCKDOWN_ONE_AT_A_TIME: &str = "one_at_a_time";
pub const LOCKDOWN_KIOSK: &str = "kiosk";

pub fn effective_lockdown_mode(course_lockdown_enabled: bool, row: &CourseItemQuizRow) -> &'static str {
    if !course_lockdown_enabled {
        return LOCKDOWN_STANDARD;
    }
    match row.lockdown_mode.as_str() {
        LOCKDOWN_ONE_AT_A_TIME => LOCKDOWN_ONE_AT_A_TIME,
        LOCKDOWN_KIOSK => LOCKDOWN_KIOSK,
        _ => LOCKDOWN_STANDARD,
    }
}

pub fn server_enforces_forward_lockdown(mode: &str) -> bool {
    mode == LOCKDOWN_ONE_AT_A_TIME || mode == LOCKDOWN_KIOSK
}

pub fn hints_disabled(mode: &str) -> bool {
    mode != LOCKDOWN_STANDARD
}

pub fn back_navigation_allowed(mode: &str) -> bool {
    mode == LOCKDOWN_STANDARD
}

pub fn parse_lockdown_mode_setting(raw: &str) -> Option<&'static str> {
    match raw.trim() {
        LOCKDOWN_STANDARD => Some(LOCKDOWN_STANDARD),
        LOCKDOWN_ONE_AT_A_TIME => Some(LOCKDOWN_ONE_AT_A_TIME),
        LOCKDOWN_KIOSK => Some(LOCKDOWN_KIOSK),
        _ => None,
    }
}
