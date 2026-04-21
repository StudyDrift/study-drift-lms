//! Adaptive quiz steps via OpenRouter (`adaptive_quiz` system prompt).
//! Each call may return up to two upcoming questions so the client can stay one step ahead.

use serde::Deserialize;
use serde_json::json;

use crate::error::AppError;
use crate::models::course_module_quiz::{
    AdaptiveQuizGeneratedQuestion, AdaptiveQuizHistoryTurn, MAX_ADAPTIVE_QUESTION_COUNT,
};
use crate::repos::system_prompts;
use crate::services::ai::{OpenRouterClient, OpenRouterError};

const ADAPTIVE_QUIZ_PROMPT_KEY: &str = "adaptive_quiz";

const FALLBACK_ADAPTIVE_QUIZ_SYSTEM_PROMPT: &str = r#"You generate quiz questions for an adaptive LMS quiz. Each learner request asks for a batch of 1 or 2 **new** questions (never duplicates of each other). Respond with ONLY valid JSON (no markdown fences, no commentary).

When asked for one question, respond with a JSON array containing exactly one object.
When asked for two questions, respond with a JSON array containing exactly two objects, in the order the learner should see them.

Each array element must be an object with camelCase keys:
- prompt (string, required): the question text shown to the learner.
- questionType (string, required): one of exactly: multiple_choice, true_false
- choices (array of strings): for multiple_choice supply exactly 4 distinct plausible options; for true_false use ["True","False"] in that order.
- choiceWeights (array of numbers): same length as choices; each value is between 0 and 1 meaning how correct that option is (1 = fully correct, 0 = incorrect).
- multipleAnswer (boolean, default false)
- answerWithImage (boolean, default false)
- required (boolean, default true)
- points (integer, default 1)
- estimatedMinutes (integer, default 2)

Rules:
- Base every question on the reference course materials in the user message.
- For multiple_choice, choiceWeights[i] corresponds to choices[i].
- Calibrate difficulty from the learner history.
- When totalQuestionsAllowed is greater than 5, you may occasionally ask a similar conceptual question (rephrased) to reduce guessing.
- Never reveal weights or correct answers in the prompt text."#;

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

fn extract_json_array(raw: &str) -> Option<&str> {
    let s = raw.trim();
    let start = s.find('[')?;
    let end = s.rfind(']')?;
    (end > start).then_some(&s[start..=end])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiQuestionRaw {
    prompt: String,
    #[serde(default)]
    question_type: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    choices: Vec<String>,
    #[serde(default, alias = "choiceWeights")]
    choice_weights: Option<Vec<f64>>,
    #[serde(default)]
    multiple_answer: bool,
    #[serde(default)]
    answer_with_image: bool,
    #[serde(default = "default_required")]
    required: bool,
    #[serde(default = "default_points")]
    points: i32,
    #[serde(default = "default_estimated_minutes")]
    estimated_minutes: i32,
}

fn default_required() -> bool {
    true
}

fn default_points() -> i32 {
    1
}

fn default_estimated_minutes() -> i32 {
    2
}

fn normalize_weights(raw: Option<Vec<f64>>, len: usize) -> Vec<f64> {
    let mut w = raw.unwrap_or_default();
    if w.len() != len {
        w = vec![0.0; len];
    }
    w.into_iter()
        .map(|x| {
            if x.is_finite() {
                x.clamp(0.0, 1.0)
            } else {
                0.0
            }
        })
        .collect()
}

fn normalize_question(mut raw: AiQuestionRaw) -> Result<AdaptiveQuizGeneratedQuestion, AppError> {
    let qt = raw
        .question_type
        .or(raw.kind)
        .unwrap_or_default()
        .trim()
        .to_string();
    if qt != "multiple_choice" && qt != "true_false" {
        return Err(AppError::AiGenerationFailed(format!(
            "Model returned unsupported questionType: {qt} (expected multiple_choice or true_false)."
        )));
    }

    let prompt = raw.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(AppError::AiGenerationFailed(
            "Model returned an empty question prompt.".into(),
        ));
    }

    let mut choices: Vec<String> = raw
        .choices
        .into_iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .collect();

    if qt == "true_false" {
        choices = vec!["True".to_string(), "False".to_string()];
    } else if choices.len() != 4 {
        return Err(AppError::AiGenerationFailed(
            "Adaptive multiple_choice questions must have exactly 4 choices.".into(),
        ));
    }

    let weights_src = raw.choice_weights.take();
    let choice_weights = normalize_weights(weights_src, choices.len());

    Ok(AdaptiveQuizGeneratedQuestion {
        question_id: None,
        prompt,
        question_type: qt,
        choices,
        choice_weights,
        multiple_answer: raw.multiple_answer,
        answer_with_image: raw.answer_with_image,
        required: raw.required,
        points: raw.points.max(0),
        estimated_minutes: raw.estimated_minutes.max(0),
    })
}

fn parse_question_batch(
    text: &str,
    expected: usize,
) -> Result<Vec<AdaptiveQuizGeneratedQuestion>, AppError> {
    let slice = extract_json_array(text).ok_or_else(|| {
        AppError::AiGenerationFailed(
            "Could not find a JSON array in the model response (expected an array of questions)."
                .into(),
        )
    })?;

    let raw_items: Vec<AiQuestionRaw> = serde_json::from_str(slice).map_err(|e| {
        AppError::AiGenerationFailed(format!("Could not parse adaptive quiz JSON array: {e}"))
    })?;

    if raw_items.len() != expected {
        return Err(AppError::AiGenerationFailed(format!(
            "Expected exactly {expected} question(s) in the JSON array; got {}.",
            raw_items.len()
        )));
    }

    let mut out = Vec::with_capacity(expected);
    for raw in raw_items {
        out.push(normalize_question(raw)?);
    }
    Ok(out)
}

fn history_json(history: &[AdaptiveQuizHistoryTurn]) -> serde_json::Value {
    serde_json::to_value(history).unwrap_or_else(|_| json!([]))
}

/// Generates the next `batch_size` questions (1 or 2). `history` = completed steps only.
///
/// When `mastery_summary` is set (learner model), it is appended to the user message for calibration.
pub async fn generate_adaptive_next_questions(
    pool: &sqlx::PgPool,
    client: &OpenRouterClient,
    model: &str,
    reference_materials: &str,
    instructor_system_prompt: &str,
    adaptive_difficulty: &str,
    adaptive_topic_balance: bool,
    adaptive_stop_rule: &str,
    total_questions_allowed: i32,
    history: &[AdaptiveQuizHistoryTurn],
    batch_size: i32,
    mastery_summary: Option<&str>,
) -> Result<Vec<AdaptiveQuizGeneratedQuestion>, AppError> {
    let system = system_prompts::get_content_by_key(pool, ADAPTIVE_QUIZ_PROMPT_KEY)
        .await?
        .unwrap_or_else(|| FALLBACK_ADAPTIVE_QUIZ_SYSTEM_PROMPT.to_string());

    let answered = history.len() as i32;
    if answered >= total_questions_allowed {
        return Err(AppError::invalid_input(
            "No more questions in this adaptive attempt.",
        ));
    }

    let expected = batch_size.clamp(1, 2) as usize;
    let remaining_after_batch = (total_questions_allowed - answered) as usize;
    if expected > remaining_after_batch {
        return Err(AppError::invalid_input(
            "Adaptive batch size exceeds remaining questions.",
        ));
    }

    let cap = total_questions_allowed.clamp(1, MAX_ADAPTIVE_QUESTION_COUNT);
    let balance_note = if adaptive_topic_balance {
        "Aim to spread coverage across the reference materials when possible."
    } else {
        "You may focus on the most relevant reference sections."
    };
    let stop_note = if adaptive_stop_rule == "mastery_estimate" {
        "If the learner has demonstrated strong, consistent understanding in recent answers, you may shift toward synthesis or harder application rather than repeating similar recall items before the cap."
    } else {
        "Continue generating questions until the question cap is reached."
    };

    let batch_instruction = if expected == 1 {
        "Generate exactly 1 new question as a JSON array with one object (not a bare object)."
    } else {
        "Generate exactly 2 new questions as a JSON array with two objects, in presentation order. The second must adapt to the same learner history as the first (anticipate no further answers between them), but must not repeat the first question's stem or choices."
    };

    let mastery_block = mastery_summary
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n\nKnown concept mastery in this course (0–1 scale; topic label, then score): {s}\n"))
        .unwrap_or_default();

    let user_body = format!(
        "Reference course materials (for grounding only; do not quote long passages verbatim):\n\
         ---\n{reference_materials}\n---\n\n\
         Instructor system prompt (follow unless it conflicts with safety or schema):\n\
         ---\n{instructor_system_prompt}\n---\n\n\
         Target difficulty level for this quiz: {adaptive_difficulty}\n\
         Topic coverage: {balance_note}\n\
         Stop rule: {stop_note}\n\n\
         totalQuestionsAllowed: {cap}\n\
         questionsAlreadyAnswered: {answered}\n\n\
         Learner history (most recent last). Each entry includes what they saw and how they answered. \
         choiceWeights are internal correctness scores (0–1) you assigned for that question; use them to adapt difficulty and to detect shallow guessing:\n\
         {history}\n\
         {mastery_block}\n\
         {batch_instruction} following your system instructions.",
        reference_materials = reference_materials.trim(),
        instructor_system_prompt = instructor_system_prompt.trim(),
        adaptive_difficulty = adaptive_difficulty.trim(),
        history = history_json(history).to_string()
    );

    let messages = vec![
        json!({"role": "system", "content": system}),
        json!({"role": "user", "content": user_body}),
    ];

    let msg = client
        .chat_completion(model, &messages, &[])
        .await
        .map_err(map_open_router_err)?;

    let text = msg.content.unwrap_or_default();
    if text.trim().is_empty() {
        return Err(AppError::AiGenerationFailed(
            "The model returned an empty response.".into(),
        ));
    }

    parse_question_batch(&text, expected)
}
