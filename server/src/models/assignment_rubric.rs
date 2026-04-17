//! Assignment rubrics: criteria rows with point-band levels, and per-criterion grade scores.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

const MAX_CRITERIA: usize = 40;
const MAX_LEVELS_PER_CRITERION: usize = 12;
const MAX_TITLE_LEN: usize = 512;
const MAX_DESC_LEN: usize = 2000;
const MAX_LEVEL_LABEL_LEN: usize = 256;
const MAX_LEVEL_DESC_LEN: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricDefinition {
    /// Optional heading shown above the rubric (e.g. section title).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub criteria: Vec<RubricCriterion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricCriterion {
    pub id: Uuid,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub levels: Vec<RubricLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricLevel {
    pub label: String,
    pub points: f64,
    /// Optional notes for this rating band on this criterion (shown under points in the editor).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Validates shape and bounds; does not check `points_worth` alignment (see
/// [`validate_rubric_against_points_worth`]).
pub fn validate_rubric_definition(r: &RubricDefinition) -> Result<(), AppError> {
    if let Some(t) = &r.title {
        let tt = t.trim();
        if tt.is_empty() {
            return Err(AppError::InvalidInput(
                "Rubric title cannot be whitespace only.".into(),
            ));
        }
        if tt.len() > MAX_TITLE_LEN {
            return Err(AppError::InvalidInput(
                "Rubric title is too long.".into(),
            ));
        }
    }
    if r.criteria.is_empty() {
        return Err(AppError::InvalidInput(
            "Rubric must include at least one criterion.".into(),
        ));
    }
    if r.criteria.len() > MAX_CRITERIA {
        return Err(AppError::InvalidInput(format!(
            "Rubric cannot have more than {} criteria.",
            MAX_CRITERIA
        )));
    }
    let mut seen_ids = HashSet::new();
    for c in &r.criteria {
        if !seen_ids.insert(c.id) {
            return Err(AppError::InvalidInput(
                "Rubric criterion ids must be unique.".into(),
            ));
        }
        let t = c.title.trim();
        if t.is_empty() {
            return Err(AppError::InvalidInput(
                "Each rubric criterion needs a title.".into(),
            ));
        }
        if t.len() > MAX_TITLE_LEN {
            return Err(AppError::InvalidInput(
                "Rubric criterion title is too long.".into(),
            ));
        }
        if let Some(d) = &c.description {
            if d.len() > MAX_DESC_LEN {
                return Err(AppError::InvalidInput(
                    "Rubric criterion description is too long.".into(),
                ));
            }
        }
        if c.levels.is_empty() {
            return Err(AppError::InvalidInput(
                "Each rubric criterion needs at least one level.".into(),
            ));
        }
        if c.levels.len() > MAX_LEVELS_PER_CRITERION {
            return Err(AppError::InvalidInput(format!(
                "Each rubric criterion cannot have more than {} levels.",
                MAX_LEVELS_PER_CRITERION
            )));
        }
        for lvl in &c.levels {
            let lab = lvl.label.trim();
            if lab.is_empty() {
                return Err(AppError::InvalidInput(
                    "Each rubric level needs a label.".into(),
                ));
            }
            if lab.len() > MAX_LEVEL_LABEL_LEN {
                return Err(AppError::InvalidInput(
                    "Rubric level label is too long.".into(),
                ));
            }
            if let Some(d) = &lvl.description {
                if d.len() > MAX_LEVEL_DESC_LEN {
                    return Err(AppError::InvalidInput(
                        "Rubric level description is too long.".into(),
                    ));
                }
            }
            if !lvl.points.is_finite() || lvl.points < 0.0 {
                return Err(AppError::InvalidInput(
                    "Rubric level points must be a non-negative finite number.".into(),
                ));
            }
        }
    }
    Ok(())
}

/// When `points_worth` is set, the sum of each criterion's maximum level points must match it.
pub fn validate_rubric_against_points_worth(
    r: &RubricDefinition,
    points_worth: Option<i32>,
) -> Result<(), AppError> {
    let Some(pw) = points_worth.filter(|p| *p > 0) else {
        return Ok(());
    };
    let sum_max: f64 = r
        .criteria
        .iter()
        .map(|c| {
            c.levels
                .iter()
                .map(|l| l.points)
                .fold(0.0_f64, f64::max)
        })
        .sum();
    let expected = pw as f64;
    if (sum_max - expected).abs() > 1e-3 {
        return Err(AppError::InvalidInput(format!(
            "Rubric total (sum of each criterion's highest level) must equal the assignment points ({}).",
            pw
        )));
    }
    Ok(())
}

/// Ensures every criterion has a score matching one of its level point values.
pub fn validate_rubric_scores_for_grade(
    rubric: &RubricDefinition,
    scores: &HashMap<Uuid, f64>,
) -> Result<f64, AppError> {
    let mut total = 0.0_f64;
    for c in &rubric.criteria {
        let Some(p) = scores.get(&c.id).copied() else {
            return Err(AppError::InvalidInput(
                "Rubric grading must include a score for every criterion.".into(),
            ));
        };
        if !p.is_finite() || p < 0.0 {
            return Err(AppError::InvalidInput(
                "Rubric criterion score must be a non-negative finite number.".into(),
            ));
        }
        let allowed: Vec<f64> = c.levels.iter().map(|l| l.points).collect();
        if !allowed.iter().any(|a| (a - p).abs() < 1e-6) {
            return Err(AppError::InvalidInput(
                "Each rubric score must match one of the level point values for that criterion."
                    .into(),
            ));
        }
        total += p;
    }
    if scores.len() != rubric.criteria.len() {
        return Err(AppError::InvalidInput(
            "Rubric grading includes unknown criteria.".into(),
        ));
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use uuid::Uuid;

    #[test]
    fn validates_scores_against_level_points() {
        let id = Uuid::new_v4();
        let r = RubricDefinition {
            title: None,
            criteria: vec![RubricCriterion {
                id,
                title: "Quality".into(),
                description: None,
                levels: vec![
                    RubricLevel {
                        label: "Good".into(),
                        points: 5.0,
                        description: None,
                    },
                    RubricLevel {
                        label: "Bad".into(),
                        points: 0.0,
                        description: None,
                    },
                ],
            }],
        };
        let mut m = HashMap::new();
        m.insert(id, 5.0);
        assert!(validate_rubric_scores_for_grade(&r, &m).is_ok());
        m.insert(id, 3.0);
        assert!(validate_rubric_scores_for_grade(&r, &m).is_err());
    }
}
