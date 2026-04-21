//! Lexical retrieval over client-supplied notebook Markdown, then grounded answering via OpenRouter.

use serde_json::json;
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::student_notebook_rag::{
    StudentNotebookDocInput, StudentNotebookRagResponse, StudentNotebookRagSource,
};
use crate::repos::user_ai_settings;
use crate::services::ai::{OpenRouterClient, OpenRouterError};

const MAX_QUESTION_CHARS: usize = 2_000;
const MAX_NOTEBOOKS: usize = 48;
const MAX_MARKDOWN_PER_NOTEBOOK: usize = 100_000;
const MAX_TOTAL_MARKDOWN: usize = 320_000;
const CHUNK_CHAR_TARGET: usize = 1_100;
const CHUNK_CHAR_STRIDE: usize = 720;
const MAX_CHUNKS_IN_PROMPT: usize = 14;
const SOURCE_EXCERPT_CHARS: usize = 220;

const SYSTEM_PROMPT: &str = r#"You answer questions using only the student's private course notebook excerpts provided below.

Rules:
- Ground every factual claim in the excerpts. If the excerpts do not contain enough information, say clearly that their notes do not cover it and suggest they add notes or check the relevant course.
- When you reference a course, name it naturally and include its course code in parentheses (e.g. "Introduction to Lextures (C-892CB7)").
- Respond in Markdown (headings optional, use bullet lists when helpful). Do not wrap the entire answer in a single fenced code block.
- Do not invent assignments, deadlines, grades, or instructor statements that are not in the excerpts."#;

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

fn normalize_markdown_output(raw: &str) -> String {
    let s = raw.trim();
    if !s.starts_with("```") {
        return s.to_string();
    }
    let mut lines: Vec<&str> = s.lines().collect();
    if lines
        .first()
        .is_some_and(|l| l.trim_start().starts_with("```"))
    {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.trim() == "```") {
        lines.pop();
    }
    lines.join("\n").trim().to_string()
}

fn tokenize(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            cur.push(ch.to_ascii_lowercase());
        } else if !cur.is_empty() {
            if cur.len() >= 2 {
                out.push(cur);
            }
            cur = String::new();
        }
    }
    if cur.len() >= 2 {
        out.push(cur);
    }
    out
}

fn token_counts(tokens: &[String]) -> HashMap<String, u32> {
    let mut m = HashMap::new();
    for t in tokens {
        *m.entry(t.clone()).or_insert(0) += 1;
    }
    m
}

fn coarse_chunks(text: &str) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let end = (i + CHUNK_CHAR_TARGET).min(chars.len());
        let chunk: String = chars[i..end].iter().collect();
        let t = chunk.trim();
        if !t.is_empty() {
            out.push(t.to_string());
        }
        if end == chars.len() {
            break;
        }
        i += CHUNK_CHAR_STRIDE;
    }
    out
}

struct ScoredChunk {
    course_code: String,
    course_title: String,
    text: String,
    score: u32,
}

fn lexical_score(
    query_tokens: &[String],
    chunk: &str,
    course_code: &str,
    course_title: &str,
) -> u32 {
    let q_counts = token_counts(query_tokens);
    if q_counts.is_empty() {
        return 0;
    }
    let c_tokens = tokenize(chunk);
    let c_counts = token_counts(&c_tokens);
    let mut s = 0u32;
    for (term, qn) in &q_counts {
        if let Some(&cn) = c_counts.get(term) {
            let hits = (*qn).min(4u32) * cn.min(6u32);
            s += hits;
        }
    }
    let title_tok = tokenize(course_title);
    let code_tok = tokenize(course_code);
    for term in &title_tok {
        if q_counts.contains_key(term) {
            s += 2;
        }
    }
    for term in &code_tok {
        if q_counts.contains_key(term) {
            s += 3;
        }
    }
    s
}

fn retrieve_chunks(question: &str, notebooks: &[StudentNotebookDocInput]) -> Vec<ScoredChunk> {
    let query_tokens = tokenize(question);
    let mut candidates: Vec<ScoredChunk> = Vec::new();
    for nb in notebooks {
        for ch in coarse_chunks(&nb.markdown) {
            let score = lexical_score(&query_tokens, &ch, &nb.course_code, &nb.course_title);
            candidates.push(ScoredChunk {
                course_code: nb.course_code.clone(),
                course_title: nb.course_title.clone(),
                text: ch,
                score,
            });
        }
    }
    candidates.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.text.len().cmp(&b.text.len()))
    });
    candidates.truncate(MAX_CHUNKS_IN_PROMPT);
    candidates
}

fn excerpt(s: &str) -> String {
    let t = s.replace('\n', " ").replace('\r', "");
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() <= SOURCE_EXCERPT_CHARS {
        return t;
    }
    t.chars()
        .take(SOURCE_EXCERPT_CHARS.saturating_sub(1))
        .collect::<String>()
        + "…"
}

/// Validates input sizes and maps failures to [`crate::error::AppError`] via `invalid_input`.
pub fn validate_notebook_rag_request(
    question: &str,
    notebooks: &[StudentNotebookDocInput],
) -> Result<(), String> {
    let q = question.trim();
    if q.is_empty() {
        return Err("Ask a question about your notes.".into());
    }
    if q.chars().count() > MAX_QUESTION_CHARS {
        return Err(format!(
            "Question is too long (max {MAX_QUESTION_CHARS} characters)."
        ));
    }
    if notebooks.is_empty() {
        return Err("Send at least one notebook with content.".into());
    }
    if notebooks.len() > MAX_NOTEBOOKS {
        return Err(format!(
            "Too many notebooks in one request (max {MAX_NOTEBOOKS})."
        ));
    }
    let mut total = 0usize;
    for nb in notebooks {
        let n = nb.markdown.chars().count();
        if n > MAX_MARKDOWN_PER_NOTEBOOK {
            return Err(format!(
                "Notebook {} exceeds the maximum size.",
                nb.course_code
            ));
        }
        total += n;
    }
    if total > MAX_TOTAL_MARKDOWN {
        return Err("Combined notebook content is too large for one question.".into());
    }
    Ok(())
}

pub async fn answer_notebook_question(
    pool: &sqlx::PgPool,
    client: &OpenRouterClient,
    user_id: Uuid,
    question: &str,
    notebooks: &[StudentNotebookDocInput],
) -> Result<StudentNotebookRagResponse, AppError> {
    validate_notebook_rag_request(question, notebooks).map_err(AppError::invalid_input)?;

    let model = user_ai_settings::get_course_setup_model_id(pool, user_id).await?;
    let q = question.trim();
    let chunks = retrieve_chunks(q, notebooks);

    let mut context = String::new();
    for (i, ch) in chunks.iter().enumerate() {
        context.push_str(&format!(
            "\n\n--- Excerpt {} — {} ({}) ---\n{}",
            i + 1,
            ch.course_title,
            ch.course_code,
            ch.text.as_str()
        ));
    }
    if context.trim().is_empty() {
        return Ok(StudentNotebookRagResponse {
            answer_markdown: "Your notebooks look empty from the server’s perspective—there were no text chunks to search. Try again after saving notes in a course notebook.".into(),
            sources: vec![],
        });
    }

    let user_body = format!(
        "Student question:\n---\n{q}\n---\n\nRelevant notebook excerpts (only use these as evidence):\n{}",
        context.trim_start()
    );

    let messages = vec![
        json!({"role": "system", "content": SYSTEM_PROMPT}),
        json!({"role": "user", "content": user_body}),
    ];

    let msg = client
        .chat_completion(&model, &messages, &[])
        .await
        .map_err(map_open_router_err)?;

    let text = msg.content.unwrap_or_default();
    let answer = normalize_markdown_output(&text);
    if answer.is_empty() {
        return Err(AppError::AiGenerationFailed(
            "The model returned an empty response.".into(),
        ));
    }

    let sources: Vec<StudentNotebookRagSource> = chunks
        .iter()
        .map(|c| StudentNotebookRagSource {
            course_code: c.course_code.clone(),
            course_title: c.course_title.clone(),
            excerpt: excerpt(&c.text),
        })
        .collect();

    Ok(StudentNotebookRagResponse {
        answer_markdown: answer,
        sources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retrieve_prefers_matching_terms() {
        let notebooks = vec![StudentNotebookDocInput {
            course_code: "C-1".into(),
            course_title: "Algebra".into(),
            markdown: "Chapter one covers linear equations and slope.".into(),
        }];
        let chunks = retrieve_chunks("linear equations slope", &notebooks);
        assert!(!chunks.is_empty());
        assert!(chunks[0].text.contains("linear") || chunks[0].text.contains("slope"));
    }
}
