//! One-shot Markdown generation for syllabus / module page sections via OpenRouter.

use serde_json::json;

use crate::error::AppError;
use crate::repos::system_prompts;
use crate::services::ai::{OpenRouterClient, OpenRouterError};

const SYLLABUS_SECTION_PROMPT_KEY: &str = "syllabus_section";

const FALLBACK_SYLLABUS_SECTION_SYSTEM_PROMPT: &str = r#"You write Markdown for a single section of an LMS syllabus, module content page, assignment description, or similar course page.

Rules:
- Output ONLY the section body as Markdown. Do not wrap the entire response in markdown code fences.
- Do not output JSON or XML. Plain Markdown only.
- Match the instructor's tone, length, and formatting requests.
- Use headings (## or ###) only when the content benefits from structure; the page may already show a section title separately.
- If the instructor asks for lists, tables, emphasis, or links, use proper Markdown syntax."#;

fn map_open_router_err(e: OpenRouterError) -> AppError {
    match e {
        OpenRouterError::NoImageInResponse => AppError::AiGenerationFailed(
            "The model returned an unexpected response.".into(),
        ),
        OpenRouterError::ApiStatus(code, msg) => AppError::AiGenerationFailed(format!(
            "OpenRouter ({code}): {}",
            msg.chars().take(800).collect::<String>()
        )),
        OpenRouterError::Http(err) => AppError::AiGenerationFailed(err.to_string()),
        OpenRouterError::Json(err) => AppError::AiGenerationFailed(err.to_string()),
    }
}

/// If the model wrapped the whole reply in ``` fences, unwrap; otherwise trim.
fn normalize_markdown_output(raw: &str) -> String {
    let s = raw.trim();
    if !s.starts_with("```") {
        return s.to_string();
    }
    let mut lines: Vec<&str> = s.lines().collect();
    if lines.first().is_some_and(|l| l.trim_start().starts_with("```")) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.trim() == "```") {
        lines.pop();
    }
    lines.join("\n").trim().to_string()
}

pub async fn generate_section_markdown(
    pool: &sqlx::PgPool,
    client: &OpenRouterClient,
    model: &str,
    instructions: &str,
    section_heading: &str,
    existing_markdown: &str,
) -> Result<String, AppError> {
    let system_prompt = match system_prompts::get_content_by_key(pool, SYLLABUS_SECTION_PROMPT_KEY).await
    {
        Ok(Some(s)) if !s.trim().is_empty() => s,
        Ok(_) => FALLBACK_SYLLABUS_SECTION_SYSTEM_PROMPT.to_string(),
        Err(e) => {
            tracing::error!(error = %e, "failed to load syllabus_section system prompt row");
            FALLBACK_SYLLABUS_SECTION_SYSTEM_PROMPT.to_string()
        }
    };

    let mut user_parts: Vec<String> = Vec::new();
    let heading = section_heading.trim();
    if !heading.is_empty() {
        user_parts.push(format!(
            "Section heading (shown separately; use only if relevant to the body):\n{heading}"
        ));
    }
    let existing = existing_markdown.trim();
    if !existing.is_empty() {
        user_parts.push(format!(
            "Current section body Markdown (you may replace or build on it):\n---\n{existing}\n---"
        ));
    }
    user_parts.push(format!(
        "Instructor instructions for this section:\n---\n{}\n---",
        instructions.trim()
    ));

    let user_body = user_parts.join("\n\n");

    let messages = vec![
        json!({"role": "system", "content": system_prompt}),
        json!({"role": "user", "content": user_body}),
    ];

    let msg = client
        .chat_completion(model, &messages, &[])
        .await
        .map_err(map_open_router_err)?;

    if !msg.tool_calls.is_empty() {
        return Err(AppError::AiGenerationFailed(
            "The model returned an unexpected tool call.".into(),
        ));
    }

    let text = msg.content.unwrap_or_default();
    let out = normalize_markdown_output(&text);
    if out.is_empty() {
        return Err(AppError::AiGenerationFailed(
            "The model returned an empty response.".into(),
        ));
    }

    Ok(out)
}
