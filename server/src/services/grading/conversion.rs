//! Pure helpers: map stored points to display strings and labeled inputs back to points.

use serde_json::{json, Value};

const EPS: f64 = 1e-6;

/// How grades are shown / entered for a column (course scheme or assignment override).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayGradingKind {
    Points,
    Percentage,
    Letter,
    Gpa,
    PassFail,
    CompleteIncomplete,
}

impl DisplayGradingKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "points" => Some(Self::Points),
            "percentage" => Some(Self::Percentage),
            "letter" => Some(Self::Letter),
            "gpa" => Some(Self::Gpa),
            "pass_fail" => Some(Self::PassFail),
            "complete_incomplete" => Some(Self::CompleteIncomplete),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Points => "points",
            Self::Percentage => "percentage",
            Self::Letter => "letter",
            Self::Gpa => "gpa",
            Self::PassFail => "pass_fail",
            Self::CompleteIncomplete => "complete_incomplete",
        }
    }
}

/// One row in `scale_json` for letter / GPA scales (sorted by `min_pct` when parsed).
#[derive(Debug, Clone, PartialEq)]
pub struct LetterTier {
    pub label: String,
    pub min_pct: f64,
    pub gpa: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedScale {
    pub kind: DisplayGradingKind,
    pub letter_tiers: Vec<LetterTier>,
    pub pass_min_pct: f64,
    pub complete_min_pct: f64,
}

/// Default US-style letter bands (A ≥ 90 … F); used as template when saving letter/GPA without bands.
pub fn default_letter_scale_json() -> Value {
    json!([
        {"label": "A", "min_pct": 90.0, "gpa": 4.0},
        {"label": "B", "min_pct": 80.0, "gpa": 3.0},
        {"label": "C", "min_pct": 70.0, "gpa": 2.0},
        {"label": "D", "min_pct": 60.0, "gpa": 1.0},
        {"label": "F", "min_pct": 0.0, "gpa": 0.0}
    ])
}

pub fn normalize_scheme_type_for_storage(kind: DisplayGradingKind, scale_json: Option<Value>) -> Value {
    match kind {
        DisplayGradingKind::Letter | DisplayGradingKind::Gpa => match scale_json {
            Some(v) if !v.is_null() => v,
            _ => default_letter_scale_json(),
        },
        _ => scale_json.unwrap_or_else(|| json!({})),
    }
}

/// Validates `scale_json` for the given scheme kind. Letter/GPA require non-overlapping contiguous bands on [0, 100].
pub fn validate_scale_json(kind: DisplayGradingKind, scale_json: Option<&Value>) -> Result<(), String> {
    let _ = parse_scale(kind, scale_json)?;
    Ok(())
}

pub fn parse_scale(kind: DisplayGradingKind, scale_json: Option<&Value>) -> Result<ParsedScale, String> {
    match kind {
        DisplayGradingKind::Points | DisplayGradingKind::Percentage => Ok(ParsedScale {
            kind,
            letter_tiers: Vec::new(),
            pass_min_pct: 60.0,
            complete_min_pct: 50.0,
        }),
        DisplayGradingKind::Letter | DisplayGradingKind::Gpa => {
            let arr = scale_json
                .and_then(|v| v.as_array())
                .ok_or_else(|| "Letter and GPA schemes need scaleJson as an array of {label, min_pct, gpa?}.".to_string())?;
            if arr.is_empty() {
                return Err("Letter scale must include at least one band.".into());
            }
            let mut tiers: Vec<LetterTier> = Vec::new();
            for (i, row) in arr.iter().enumerate() {
                let label = row
                    .get("label")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("Band {i}: missing string label"))?
                    .trim()
                    .to_string();
                if label.is_empty() {
                    return Err(format!("Band {i}: label is empty"));
                }
                let min_pct = row
                    .get("min_pct")
                    .and_then(|v| v.as_f64())
                    .ok_or_else(|| format!("Band {i}: min_pct must be a number"))?;
                if !min_pct.is_finite() || min_pct < 0.0 || min_pct > 100.0 + EPS {
                    return Err(format!("Band {i}: min_pct must be between 0 and 100"));
                }
                let gpa = row.get("gpa").and_then(|v| v.as_f64());
                if let Some(g) = gpa {
                    if !g.is_finite() || g < 0.0 {
                        return Err(format!("Band {i}: gpa must be a non-negative number"));
                    }
                }
                tiers.push(LetterTier {
                    label,
                    min_pct,
                    gpa,
                });
            }
            tiers.sort_by(|a, b| {
                b.min_pct
                    .partial_cmp(&a.min_pct)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let mut ascending: Vec<LetterTier> = tiers.iter().cloned().collect();
            ascending.sort_by(|a, b| {
                a.min_pct
                    .partial_cmp(&b.min_pct)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            for w in ascending.windows(2) {
                if w[1].min_pct <= w[0].min_pct + EPS {
                    return Err("Letter bands must have strictly increasing min_pct values.".into());
                }
            }
            if (ascending[0].min_pct - 0.0).abs() > EPS {
                return Err("Lowest letter band must start at min_pct 0 (typically F).".into());
            }
            Ok(ParsedScale {
                kind,
                letter_tiers: tiers,
                pass_min_pct: 60.0,
                complete_min_pct: 50.0,
            })
        }
        DisplayGradingKind::PassFail => {
            let pass_min = scale_json
                .and_then(|o| o.get("pass_min_pct"))
                .and_then(|v| v.as_f64())
                .unwrap_or(60.0);
            if !pass_min.is_finite() || pass_min < 0.0 || pass_min > 100.0 + EPS {
                return Err("pass_min_pct must be between 0 and 100.".into());
            }
            Ok(ParsedScale {
                kind,
                letter_tiers: Vec::new(),
                pass_min_pct: pass_min,
                complete_min_pct: 50.0,
            })
        }
        DisplayGradingKind::CompleteIncomplete => {
            let cmin = scale_json
                .and_then(|o| o.get("complete_min_pct"))
                .and_then(|v| v.as_f64())
                .unwrap_or(50.0);
            if !cmin.is_finite() || cmin < 0.0 || cmin > 100.0 + EPS {
                return Err("complete_min_pct must be between 0 and 100.".into());
            }
            Ok(ParsedScale {
                kind,
                letter_tiers: Vec::new(),
                pass_min_pct: 60.0,
                complete_min_pct: cmin,
            })
        }
    }
}

pub fn resolve_effective(
    course_kind: Option<DisplayGradingKind>,
    assignment_override: Option<&str>,
) -> DisplayGradingKind {
    if let Some(s) = assignment_override.and_then(|x| {
        let t = x.trim();
        if t.is_empty() {
            None
        } else {
            DisplayGradingKind::from_str(t)
        }
    }) {
        return s;
    }
    course_kind.unwrap_or(DisplayGradingKind::Points)
}

fn pct_from_points(points: f64, max: f64) -> f64 {
    if max <= EPS {
        return 0.0;
    }
    let raw = (points / max) * 100.0;
    (raw * 1000.0).round() / 1000.0
}

fn format_points(points: f64) -> String {
    if !points.is_finite() || points < 0.0 {
        return String::new();
    }
    let i = points as i64;
    if (points - i as f64).abs() < EPS {
        return i.to_string();
    }
    let mut s = format!("{:.4}", points);
    while s.contains('.') && (s.ends_with('0') || s.ends_with('.')) {
        s.pop();
    }
    s
}

fn format_pct(p: f64) -> String {
    let mut s = format!("{:.2}", p);
    while s.contains('.') && (s.ends_with('0') || s.ends_with('.')) {
        s.pop();
    }
    s
}

fn tier_upper_pct(tiers_sorted_desc: &[LetterTier], idx: usize) -> f64 {
    if idx == 0 {
        100.0
    } else {
        tiers_sorted_desc[idx - 1].min_pct
    }
}

fn midpoint_pct_in_band(low: f64, high: f64) -> f64 {
    (low + high) / 2.0
}

/// Maps stored points to the string instructors and learners should see.
pub fn to_display_grade(
    points: f64,
    max_points: Option<f64>,
    course_scale: Option<&ParsedScale>,
    effective: DisplayGradingKind,
) -> String {
    if !points.is_finite() || points < 0.0 {
        return String::new();
    }
    let max = max_points.filter(|m| *m > EPS);
    match effective {
        DisplayGradingKind::Points => format_points(points),
        DisplayGradingKind::Percentage => {
            let Some(m) = max else {
                return format_points(points);
            };
            format!("{}%", format_pct(pct_from_points(points, m)))
        }
        DisplayGradingKind::Letter | DisplayGradingKind::Gpa => {
            let Some(m) = max else {
                return format_points(points);
            };
            let Some(scale) = course_scale else {
                return format_points(points);
            };
            let pct = pct_from_points(points, m);
            for (i, t) in scale.letter_tiers.iter().enumerate() {
                let upper = tier_upper_pct(&scale.letter_tiers, i);
                if pct + EPS >= t.min_pct && pct <= upper + EPS {
                    return if matches!(effective, DisplayGradingKind::Gpa) {
                        t.gpa
                            .map(|g| format!("{:.2}", g))
                            .unwrap_or_else(|| t.label.clone())
                    } else {
                        t.label.clone()
                    };
                }
            }
            scale
                .letter_tiers
                .last()
                .map(|t| t.label.clone())
                .unwrap_or_else(|| format_points(points))
        }
        DisplayGradingKind::PassFail => {
            let Some(scale) = course_scale else {
                return format_points(points);
            };
            let Some(m) = max else {
                return if points >= EPS { "Pass".into() } else { "Fail".into() };
            };
            let pct = pct_from_points(points, m);
            if pct + EPS >= scale.pass_min_pct {
                "Pass".into()
            } else {
                "Fail".into()
            }
        }
        DisplayGradingKind::CompleteIncomplete => {
            let Some(scale) = course_scale else {
                return format_points(points);
            };
            let Some(m) = max else {
                return if points >= EPS { "Complete".into() } else { "Incomplete".into() };
            };
            let pct = pct_from_points(points, m);
            if pct + EPS >= scale.complete_min_pct {
                "Complete".into()
            } else {
                "Incomplete".into()
            }
        }
    }
}

/// Parses gradebook cell text into points to store. `None` clears the cell.
pub fn parse_gradebook_cell(
    raw: &str,
    max_points: Option<f64>,
    course_scale: Option<&ParsedScale>,
    effective: DisplayGradingKind,
) -> Result<Option<f64>, String> {
    let t = raw.trim();
    if t.is_empty() {
        return Ok(None);
    }
    let max = max_points.filter(|m| *m > EPS);

    // Numeric entry always allowed when it parses.
    let cleaned: String = t.chars().filter(|c| *c != ',' && !c.is_whitespace()).collect();
    if let Ok(n) = cleaned.parse::<f64>() {
        if !n.is_finite() || n < 0.0 {
            return Err("Each score must be a non-negative number.".into());
        }
        return Ok(Some(n));
    }

    let Some(m) = max else {
        return Err("This column has no maximum points; enter a numeric score.".into());
    };

    match effective {
        DisplayGradingKind::Points | DisplayGradingKind::Percentage => {
            Err("Enter a numeric score for this column.".into())
        }
        DisplayGradingKind::Letter | DisplayGradingKind::Gpa => {
            let Some(scale) = course_scale else {
                return Err("Course has no letter scale configured.".into());
            };
            let needle = t.trim();
            for (i, tier) in scale.letter_tiers.iter().enumerate() {
                if tier.label.eq_ignore_ascii_case(needle) {
                    let upper = tier_upper_pct(&scale.letter_tiers, i);
                    let mid_pct = midpoint_pct_in_band(tier.min_pct, upper);
                    return Ok(Some((mid_pct / 100.0) * m));
                }
            }
            Err(format!("Unknown letter grade \"{needle}\" for this scale."))
        }
        DisplayGradingKind::PassFail => {
            let Some(scale) = course_scale else {
                return Err("Course has no pass/fail settings.".into());
            };
            let u = t.to_ascii_lowercase();
            if u == "pass" || u == "p" {
                let mid = midpoint_pct_in_band(scale.pass_min_pct, 100.0);
                return Ok(Some((mid / 100.0) * m));
            }
            if u == "fail" || u == "f" {
                let mid = midpoint_pct_in_band(0.0, scale.pass_min_pct);
                return Ok(Some((mid / 100.0) * m));
            }
            Err("Enter Pass or Fail (or a number).".into())
        }
        DisplayGradingKind::CompleteIncomplete => {
            let u = t.to_ascii_lowercase();
            if u == "complete" || u == "c" {
                return Ok(Some(m));
            }
            if u == "incomplete" || u == "i" {
                return Ok(Some(0.0));
            }
            Err("Enter Complete or Incomplete (or a number).".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn letter_scale() -> ParsedScale {
        parse_scale(
            DisplayGradingKind::Letter,
            Some(&default_letter_scale_json()),
        )
        .unwrap()
    }

    #[test]
    fn letter_display_a() {
        let s = letter_scale();
        assert_eq!(
            to_display_grade(95.0, Some(100.0), Some(&s), DisplayGradingKind::Letter),
            "A"
        );
    }

    #[test]
    fn letter_recalc_when_cutoff_changes() {
        let s1 = parse_scale(
            DisplayGradingKind::Letter,
            Some(&json!([
                {"label": "A", "min_pct": 93.0, "gpa": 4.0},
                {"label": "F", "min_pct": 0.0, "gpa": 0.0}
            ])),
        )
        .unwrap();
        assert_eq!(
            to_display_grade(92.0, Some(100.0), Some(&s1), DisplayGradingKind::Letter),
            "F"
        );
        let s2 = parse_scale(
            DisplayGradingKind::Letter,
            Some(&json!([
                {"label": "A", "min_pct": 90.0, "gpa": 4.0},
                {"label": "F", "min_pct": 0.0, "gpa": 0.0}
            ])),
        )
        .unwrap();
        assert_eq!(
            to_display_grade(92.0, Some(100.0), Some(&s2), DisplayGradingKind::Letter),
            "A"
        );
    }

    #[test]
    fn pass_fail_fail_stores_low_points() {
        let s = parse_scale(
            DisplayGradingKind::PassFail,
            Some(&json!({"pass_min_pct": 60.0})),
        )
        .unwrap();
        let pts = parse_gradebook_cell("Fail", Some(100.0), Some(&s), DisplayGradingKind::PassFail)
            .unwrap()
            .unwrap();
        assert!(pts < 60.0);
        assert_eq!(
            to_display_grade(pts, Some(100.0), Some(&s), DisplayGradingKind::PassFail),
            "Fail"
        );
    }

    #[test]
    fn complete_incomplete_column() {
        let s = parse_scale(DisplayGradingKind::CompleteIncomplete, Some(&json!({}))).unwrap();
        assert_eq!(
            to_display_grade(80.0, Some(100.0), Some(&s), DisplayGradingKind::CompleteIncomplete),
            "Complete"
        );
        assert_eq!(
            to_display_grade(40.0, Some(100.0), Some(&s), DisplayGradingKind::CompleteIncomplete),
            "Incomplete"
        );
    }
}
