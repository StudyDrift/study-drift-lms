//! AI-generated quiz questions via OpenRouter using the `quiz_generation` system prompt row.

use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_module_quiz::{QuizQuestion, QUIZ_QUESTION_TYPES};
use crate::repos::system_prompts;
use crate::services::ai::{OpenRouterClient, OpenRouterError};

const QUIZ_GENERATION_PROMPT_KEY: &str = "quiz_generation";

const FALLBACK_QUIZ_GENERATION_SYSTEM_PROMPT: &str = r#"You generate quiz questions for an LMS. You respond with ONLY valid JSON (no markdown fences, no commentary).

The JSON must be an object: {"questions":[...]}.

Each question object uses camelCase keys and must match this app schema:
- prompt (string, required)
- questionType (string, required): one of exactly: multiple_choice, fill_in_blank, essay, true_false, short_answer
- choices (array of strings): for multiple_choice supply 3–5 distinct options; for true_false use ["True","False"] in that order; for fill_in_blank, essay, short_answer use []
- correctChoiceIndex (number or null): for multiple_choice and true_false, 0-based index into choices when a single best answer exists; otherwise null
- multipleAnswer (boolean, default false)
- answerWithImage (boolean, default false)
- required (boolean, default true)
- points (integer, default 1)
- estimatedMinutes (integer, default 2)

Rules:
- Use a mix of question types across the batch when the requested count allows (at least two different types when count >= 2).
- Keep prompts clear and appropriate for the instructor topic.
- For multiple_choice, ensure correctChoiceIndex refers to a valid choice index when set."#;

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

fn extract_json_object(raw: &str) -> Option<&str> {
    let s = raw.trim();
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    (end > start).then_some(&s[start..=end])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiQuestionsEnvelope {
    questions: Vec<AiQuestionRaw>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiQuestionRaw {
    prompt: String,
    #[serde(default)]
    question_type: Option<String>,
    /// Some models send `type` instead.
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    choices: Vec<String>,
    #[serde(default)]
    correct_choice_index: Option<usize>,
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

fn normalize_raw_to_question(raw: AiQuestionRaw) -> Result<QuizQuestion, AppError> {
    let qt = raw
        .question_type
        .or(raw.kind)
        .unwrap_or_default()
        .trim()
        .to_string();
    if !QUIZ_QUESTION_TYPES.contains(&qt.as_str()) {
        return Err(AppError::AiGenerationFailed(format!(
            "Model returned unsupported questionType: {qt}"
        )));
    }

    let prompt = raw.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(AppError::AiGenerationFailed(
            "Model returned a question with an empty prompt.".into(),
        ));
    }

    let mut choices: Vec<String> = raw
        .choices
        .into_iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .collect();

    let mut correct_choice_index = raw.correct_choice_index;

    match qt.as_str() {
        "multiple_choice" => {
            if choices.len() < 2 {
                return Err(AppError::AiGenerationFailed(
                    "A multiple-choice question needs at least two choices.".into(),
                ));
            }
            if let Some(i) = correct_choice_index {
                if i >= choices.len() {
                    correct_choice_index = None;
                }
            }
        }
        "true_false" => {
            choices = vec!["True".to_string(), "False".to_string()];
            if let Some(i) = correct_choice_index {
                if i > 1 {
                    correct_choice_index = None;
                }
            }
        }
        "fill_in_blank" | "essay" | "short_answer" => {
            choices.clear();
            correct_choice_index = None;
        }
        _ => {}
    }

    Ok(QuizQuestion {
        id: Uuid::new_v4().to_string(),
        prompt,
        question_type: qt,
        choices,
        correct_choice_index,
        multiple_answer: raw.multiple_answer,
        answer_with_image: raw.answer_with_image,
        required: raw.required,
        points: raw.points.max(0),
        estimated_minutes: raw.estimated_minutes.max(0),
    })
}

fn parse_model_json(text: &str, expected_count: usize) -> Result<Vec<QuizQuestion>, AppError> {
    let slice = extract_json_object(text).ok_or_else(|| {
        AppError::AiGenerationFailed("Could not find JSON in the model response.".into())
    })?;

    let env: AiQuestionsEnvelope = serde_json::from_str(slice).map_err(|e| {
        AppError::AiGenerationFailed(format!("Could not parse quiz JSON: {e}"))
    })?;

    if env.questions.len() != expected_count {
        return Err(AppError::AiGenerationFailed(format!(
            "Expected exactly {expected_count} questions, got {}.",
            env.questions.len()
        )));
    }

    env.questions
        .into_iter()
        .map(normalize_raw_to_question)
        .collect()
}

pub async fn generate_quiz_questions(
    pool: &sqlx::PgPool,
    client: &OpenRouterClient,
    model: &str,
    user_prompt: &str,
    count: usize,
) -> Result<Vec<QuizQuestion>, AppError> {
    let system = system_prompts::get_content_by_key(pool, QUIZ_GENERATION_PROMPT_KEY)
        .await?
        .unwrap_or_else(|| FALLBACK_QUIZ_GENERATION_SYSTEM_PROMPT.to_string());

    let types_list = QUIZ_QUESTION_TYPES.join(", ");
    let user_body = format!(
        "Generate exactly {count} quiz questions.\n\n\
         Allowed questionType values (use these strings exactly): {types_list}.\n\n\
         Instructor topic / instructions:\n---\n{user_prompt}\n---\n\n\
         Respond with ONLY a JSON object in this form: {{\"questions\":[...]}} using camelCase keys as described in your system instructions."
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

    parse_model_json(&text, count)
}
