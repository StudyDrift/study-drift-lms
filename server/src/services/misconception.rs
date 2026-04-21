//! Misconception tagging, event logging, and mastery weighting (plan 1.10).

use std::env;

use serde::Serialize;
use sqlx::{Executor, Postgres};
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_module_quiz::QuizQuestion;
use crate::repos::misconceptions as mc_repo;

fn mastery_alpha_multiplier() -> f64 {
    env::var("MISCONCEPTION_MASTERY_ALPHA_MULT")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .filter(|a: &f64| *a >= 1.0 && *a <= 2.0)
        .unwrap_or(1.2)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MisconceptionFeedbackPayload {
    pub id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation_url: Option<String>,
    pub recurrence_count: i64,
}

/// On a wrong MC/TF answer, optionally record a misconception event and return feedback metadata.
/// Failures are logged and swallowed so grading never depends on this path (AC-5).
pub async fn record_wrong_multiple_choice<'e, E>(
    executor: &mut E,
    pool: &sqlx::PgPool,
    course_id: Uuid,
    user_id: Uuid,
    attempt_id: Uuid,
    question_uuid: Uuid,
    q: &QuizQuestion,
    selected_display_index: usize,
    feature_enabled: bool,
) -> Option<MisconceptionFeedbackPayload>
where
    for<'a> &'a mut E: Executor<'a, Database = Postgres>,
{
    if !feature_enabled {
        return None;
    }
    if !matches!(q.question_type.as_str(), "multiple_choice" | "true_false") {
        return None;
    }
    if q.choice_ids.len() != q.choices.len() || q.choice_ids.is_empty() {
        return None;
    }
    let id_str = q.choice_ids.get(selected_display_index)?;
    let Ok(option_id) = Uuid::parse_str(id_str.trim()) else {
        return None;
    };

    let row = match mc_repo::get_misconception_for_option(pool, course_id, question_uuid, option_id)
        .await
    {
        Ok(r) => r?,
        Err(e) => {
            tracing::warn!(error = %e, "misconception.lookup_failed");
            return None;
        }
    };

    let prior = match mc_repo::count_user_misconception_triggers(pool, user_id, row.id).await {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!(error = %e, "misconception.count_failed");
            0
        }
    };
    let recurrence_count = prior + 1;

    if let Err(e) = mc_repo::insert_event(
        executor,
        course_id,
        user_id,
        attempt_id,
        question_uuid,
        row.id,
        Some(option_id),
        true,
    )
    .await
    {
        tracing::warn!(error = %e, "misconception.insert_event_failed");
        return None;
    }

    tracing::info!(
        target = "misconception",
        misconception_id = %row.id,
        question_id = %question_uuid,
        "misconception.triggered"
    );

    Some(MisconceptionFeedbackPayload {
        id: row.id,
        name: row.name,
        remediation_body: row.remediation_body,
        remediation_url: row.remediation_url,
        recurrence_count,
    })
}

pub fn mastery_alpha_multiplier_for_misconception_hit() -> f64 {
    mastery_alpha_multiplier()
}

pub fn option_uuid_for_display_choice(q: &QuizQuestion, display_index: usize) -> Option<Uuid> {
    if q.choice_ids.len() != q.choices.len() || q.choice_ids.is_empty() {
        return None;
    }
    q.choice_ids
        .get(display_index)
        .and_then(|s| Uuid::parse_str(s.trim()).ok())
}

/// Returns `AppError` when the tagged option is the authored correct choice (risk mitigation).
pub fn assert_option_not_correct_answer(
    correct_choice_index_authored: Option<usize>,
    authored_choice_ids: &[Uuid],
    option_id: Uuid,
) -> Result<(), AppError> {
    let Some(ci) = correct_choice_index_authored else {
        return Ok(());
    };
    let Some(correct_id) = authored_choice_ids.get(ci) else {
        return Ok(());
    };
    if *correct_id == option_id {
        return Err(AppError::invalid_input(
            "Cannot tag the correct answer option with a misconception.",
        ));
    }
    Ok(())
}
