//! Progressive hints, AI fallback nudges, worked-example access (plan 1.9).

use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_module_quiz::QuizQuestion;
use crate::repos::hints as hints_repo;
use crate::repos::user_ai_settings;
use crate::services::ai::{OpenRouterClient, OpenRouterError};

const GENERIC_HINT: &str = "Try re-reading the question stem slowly. Write down what is being asked and one fact you are sure of, then compare that to each option.";

fn map_open_router_err(e: OpenRouterError) -> AppError {
    match e {
        OpenRouterError::NoImageInResponse => {
            AppError::AiGenerationFailed("The model returned an unexpected response.".into())
        }
        OpenRouterError::ApiStatus(code, msg) => AppError::AiGenerationFailed(format!(
            "OpenRouter ({code}): {}",
            msg.chars().take(800).collect::<String>()
        )),
        OpenRouterError::Http(err) => AppError::AiGenerationFailed(err.to_string()),
        OpenRouterError::Json(err) => AppError::AiGenerationFailed(err.to_string()),
    }
}

/// Reduce earned points after grading: `penalty_pct_sum` is the sum of per-level penalties for revealed static hints.
pub fn apply_hint_penalty_to_points(points: f64, penalty_pct_sum: f64) -> f64 {
    let f = (1.0 - (penalty_pct_sum / 100.0)).clamp(0.0, 1.0);
    (points * f).max(0.0)
}

/// Softer mastery signal when many hints were used (plan FR-9).
pub fn mastery_scale_for_hint_uses(hint_uses: i64) -> f64 {
    if hint_uses <= 0 {
        return 1.0;
    }
    (1.0 / (1.0 + 0.12 * hint_uses as f64)).clamp(0.35, 1.0)
}

fn answer_snippets_for_leak_check(q: &QuizQuestion) -> Vec<String> {
    let mut out = Vec::new();
    match q.question_type.as_str() {
        "multiple_choice" | "true_false" => {
            if let Some(ci) = q.correct_choice_index {
                if let Some(t) = q.choices.get(ci) {
                    let s = t.trim();
                    if s.len() >= 2 {
                        out.push(s.to_lowercase());
                    }
                }
            }
        }
        "numeric" => {
            if let Some(v) = q
                .type_config
                .get("correct")
                .and_then(serde_json::Value::as_f64)
            {
                out.push(format!("{v}").to_lowercase());
            }
        }
        "formula" => {
            if let Some(s) = q
                .type_config
                .get("latex_answer")
                .or_else(|| q.type_config.get("latexAnswer"))
                .and_then(serde_json::Value::as_str)
            {
                let t = s.trim();
                if t.len() >= 3 {
                    out.push(t.to_lowercase());
                }
            }
        }
        _ => {}
    }
    out
}

fn hint_leaks_answer(hint: &str, q: &QuizQuestion) -> bool {
    let h = hint.to_lowercase();
    for snip in answer_snippets_for_leak_check(q) {
        if snip.len() >= 4 && h.contains(&snip) {
            return true;
        }
    }
    false
}

async fn ai_hint_body(
    pool: &PgPool,
    client: &OpenRouterClient,
    user_id: Uuid,
    q: &QuizQuestion,
    quid: Uuid,
    hint_level: i16,
) -> Result<String, AppError> {
    let model = user_ai_settings::get_course_setup_model_id(pool, user_id)
        .await
        .map_err(AppError::Db)?;
    let concepts = hints_repo::concept_names_for_question(pool, quid)
        .await
        .map_err(AppError::Db)?;
    let concept_block = if concepts.is_empty() {
        String::new()
    } else {
        format!(
            "\nRelated concept tags (for context only): {}.\n",
            concepts.join(", ")
        )
    };
    let stem = q.prompt.trim();
    let system = format!(
        "You write short hints for an LMS quiz question. Hint level {hint_level} of up to 5: \
         be slightly more specific as the level increases, but NEVER reveal the final answer, \
         any numeric result, any correct choice label, or any LaTeX that matches the model answer. \
         Respond with plain text only (no JSON, no markdown fences), at most 4 sentences."
    );
    let user_body =
        format!("Question stem:\n---\n{stem}\n---\n{concept_block}\nWrite the hint now.");
    let messages = vec![
        json!({"role": "system", "content": system}),
        json!({"role": "user", "content": user_body}),
    ];
    tracing::info!(
        target: "hints",
        question_id = %quid,
        hint_level,
        model = %model,
        "ai_hint.requested"
    );
    let msg = client
        .chat_completion(&model, &messages, &[])
        .await
        .map_err(map_open_router_err)?;
    let text = msg.content.unwrap_or_default();
    let t = text.trim();
    if t.is_empty() {
        return Err(AppError::AiGenerationFailed("Empty AI hint.".into()));
    }
    Ok(t.to_string())
}

/// Returns the next hint payload for this attempt/question, logging the reveal.
pub async fn reveal_next_hint(
    pool: &PgPool,
    open_router: Option<&std::sync::Arc<OpenRouterClient>>,
    student_user_id: Uuid,
    attempt_id: Uuid,
    question_id_str: &str,
    q: &QuizQuestion,
    locale: &str,
) -> Result<crate::models::course_module_quiz::QuizHintRevealResponse, AppError> {
    let quid = Uuid::parse_str(question_id_str)
        .map_err(|_| AppError::invalid_input("questionId must be a UUID for hints."))?;

    let max_used = hints_repo::max_hint_level_used(pool, attempt_id, question_id_str)
        .await
        .map_err(AppError::Db)?
        .unwrap_or(0);
    let next_level = max_used + 1;
    if next_level > 5 {
        return Ok(crate::models::course_module_quiz::QuizHintRevealResponse {
            level: None,
            body: None,
            media_url: None,
            no_more_hints: true,
        });
    }

    let static_hints = hints_repo::list_hints_for_question_locale(pool, quid, locale)
        .await
        .map_err(AppError::Db)?;
    let static_at_level = static_hints.iter().find(|h| h.level == next_level);

    if let Some(row) = static_at_level {
        let body = if hint_leaks_answer(&row.body, q) {
            tracing::warn!(question_id = %quid, "hints.static_leak_detected");
            GENERIC_HINT.to_string()
        } else {
            row.body.clone()
        };
        hints_repo::insert_hint_request(pool, attempt_id, question_id_str, next_level, "static")
            .await
            .map_err(AppError::Db)?;
        return Ok(crate::models::course_module_quiz::QuizHintRevealResponse {
            level: Some(next_level as i32),
            body: Some(body),
            media_url: row.media_url.clone(),
            no_more_hints: false,
        });
    }

    if !static_hints.is_empty() {
        return Ok(crate::models::course_module_quiz::QuizHintRevealResponse {
            level: None,
            body: None,
            media_url: None,
            no_more_hints: true,
        });
    }

    // No static hints authored: AI fallback up to level 5
    let body = match open_router {
        Some(client) => {
            match ai_hint_body(pool, client, student_user_id, q, quid, next_level).await {
                Ok(t) if !hint_leaks_answer(&t, q) => t,
                Ok(_) => {
                    tracing::warn!(question_id = %quid, "hints.ai_leak_detected");
                    GENERIC_HINT.to_string()
                }
                Err(e) => {
                    tracing::warn!(error = %e, "hints.ai_fallback");
                    GENERIC_HINT.to_string()
                }
            }
        }
        None => {
            tracing::info!("hints.ai_skipped_no_client");
            GENERIC_HINT.to_string()
        }
    };

    hints_repo::insert_hint_request(pool, attempt_id, question_id_str, next_level, "ai")
        .await
        .map_err(AppError::Db)?;

    Ok(crate::models::course_module_quiz::QuizHintRevealResponse {
        level: Some(next_level as i32),
        body: Some(body),
        media_url: None,
        no_more_hints: false,
    })
}

pub fn worked_example_steps_from_json(
    v: &serde_json::Value,
) -> Vec<crate::models::course_module_quiz::QuizWorkedExampleStep> {
    let Some(arr) = v.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (i, x) in arr.iter().enumerate() {
        let number = x
            .get("number")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(i as i64 + 1) as i32;
        let explanation = x
            .get("explanation")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string();
        let expression = x
            .get("expression")
            .and_then(serde_json::Value::as_str)
            .map(|s| s.to_string());
        out.push(crate::models::course_module_quiz::QuizWorkedExampleStep {
            number,
            explanation,
            expression,
        });
    }
    out
}

pub async fn load_worked_example_if_allowed(
    pool: &PgPool,
    attempt_id: Uuid,
    question_id_str: &str,
    attempt_status: &str,
) -> Result<Option<hints_repo::WorkedExampleRow>, AppError> {
    let quid = Uuid::parse_str(question_id_str)
        .map_err(|_| AppError::invalid_input("questionId must be a UUID."))?;
    let n_hints = hints_repo::count_hint_requests(pool, attempt_id, question_id_str)
        .await
        .map_err(AppError::Db)?;
    let unlocked = attempt_status == "submitted" || n_hints >= 2;
    if !unlocked {
        return Err(AppError::Forbidden);
    }
    Ok(hints_repo::get_worked_example(pool, quid)
        .await
        .map_err(AppError::Db)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::course_module_quiz::QuizQuestion;
    use serde_json::json;

    #[test]
    fn penalty_clamps() {
        assert!((apply_hint_penalty_to_points(10.0, 5.0) - 9.5).abs() < 1e-9);
        assert_eq!(apply_hint_penalty_to_points(10.0, 200.0), 0.0);
    }

    #[test]
    fn mastery_scale_decreases() {
        assert!(mastery_scale_for_hint_uses(3) < mastery_scale_for_hint_uses(0));
    }

    #[test]
    fn leak_detect_mc() {
        let q = QuizQuestion {
            id: "x".into(),
            prompt: "Pick".into(),
            question_type: "multiple_choice".into(),
            choices: vec!["A".into(), "B".into(), "Paris".into()],
            choice_ids: vec![],
            type_config: json!({}),
            correct_choice_index: Some(2),
            multiple_answer: false,
            answer_with_image: false,
            required: true,
            points: 1,
            estimated_minutes: 2,
            concept_ids: vec![],
            srs_eligible: true,
        };
        assert!(hint_leaks_answer("Think about Paris.", &q));
        assert!(!hint_leaks_answer(
            "Think about the capital conceptually.",
            &q
        ));
    }
}
