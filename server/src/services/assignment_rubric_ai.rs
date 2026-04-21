//! AI-generated assignment rubrics via OpenRouter using the `assignment_rubric_generation` system prompt row.

use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::assignment_rubric::{RubricCriterion, RubricDefinition, RubricLevel};
use crate::repos::system_prompts;
use crate::services::ai::{OpenRouterClient, OpenRouterError};

const ASSIGNMENT_RUBRIC_PROMPT_KEY: &str = "assignment_rubric_generation";

const FALLBACK_ASSIGNMENT_RUBRIC_SYSTEM_PROMPT: &str = r#"You generate grading rubrics for LMS assignments. Respond with ONLY valid JSON (no markdown fences, no commentary).

The JSON must be an object with camelCase keys:
{
  "title": string optional (short heading shown above the rubric),
  "criteria": [
    {
      "title": string (non-empty criterion name),
      "description": string optional (what students should demonstrate),
      "levels": [
        { "label": string (rating column name), "points": number (non-negative, finite), "description": string optional (what this band means for this criterion) }
      ]
    }
  ]
}

Rules:
- Include at least 3 criteria unless the instructor explicitly asks for fewer.
- Every criterion must have the SAME number of "levels" in the SAME ORDER (lowest points first, highest last is typical).
- For each rating column index, the "label" must be the SAME across all criteria (shared column headers).
- Within each criterion, points should usually be non-decreasing as quality improves.
- When assignment points are provided, the sum of each criterion's maximum level points must equal that total exactly."#;

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
struct AiRubricEnvelope {
    #[serde(default)]
    title: Option<String>,
    criteria: Vec<AiCriterionRaw>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiCriterionRaw {
    title: String,
    #[serde(default)]
    description: Option<String>,
    levels: Vec<AiLevelRaw>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiLevelRaw {
    label: String,
    points: f64,
    #[serde(default)]
    description: Option<String>,
}

fn trim_title(s: &Option<String>) -> Option<String> {
    s.as_ref()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

/// Pad criteria so every row has the same number of levels; sync level labels from the first row (matches web editor).
fn normalize_rubric_grid(mut r: RubricDefinition) -> RubricDefinition {
    if r.criteria.is_empty() {
        return r;
    }
    let max = r
        .criteria
        .iter()
        .map(|c| c.levels.len())
        .max()
        .unwrap_or(0)
        .max(1);

    for c in &mut r.criteria {
        while c.levels.len() < max {
            let n = c.levels.len() + 1;
            c.levels.push(RubricLevel {
                label: format!("Rating {n}"),
                points: 0.0,
                description: None,
            });
        }
        if c.levels.len() > max {
            c.levels.truncate(max);
        }
    }

    let ref_labels: Vec<String> = r.criteria[0]
        .levels
        .iter()
        .map(|l| l.label.clone())
        .collect();
    for c in r.criteria.iter_mut().skip(1) {
        for (i, lvl) in c.levels.iter_mut().enumerate() {
            if let Some(lab) = ref_labels.get(i) {
                lvl.label.clone_from(lab);
            }
        }
    }

    r
}

fn raw_to_definition(raw: AiRubricEnvelope) -> Result<RubricDefinition, AppError> {
    if raw.criteria.is_empty() {
        return Err(AppError::AiGenerationFailed(
            "Model returned no rubric criteria.".into(),
        ));
    }

    let title = trim_title(&raw.title);
    let mut criteria: Vec<RubricCriterion> = Vec::new();
    for c in raw.criteria {
        let title = c.title.trim().to_string();
        if title.is_empty() {
            return Err(AppError::AiGenerationFailed(
                "Model returned a criterion with an empty title.".into(),
            ));
        }
        if c.levels.is_empty() {
            return Err(AppError::AiGenerationFailed(
                "Model returned a criterion with no rating levels.".into(),
            ));
        }
        let description = c
            .description
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let levels: Vec<RubricLevel> = c
            .levels
            .into_iter()
            .map(|l| RubricLevel {
                label: l.label.trim().to_string(),
                points: l.points,
                description: l
                    .description
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
            })
            .collect();

        criteria.push(RubricCriterion {
            id: Uuid::new_v4(),
            title,
            description,
            levels,
        });
    }

    Ok(normalize_rubric_grid(RubricDefinition { title, criteria }))
}

fn parse_model_json(text: &str) -> Result<RubricDefinition, AppError> {
    let slice = extract_json_object(text).ok_or_else(|| {
        AppError::AiGenerationFailed("Could not find JSON in the model response.".into())
    })?;

    let raw: AiRubricEnvelope = serde_json::from_str(slice)
        .map_err(|e| AppError::AiGenerationFailed(format!("Could not parse rubric JSON: {e}")))?;

    raw_to_definition(raw)
}

pub async fn generate_assignment_rubric(
    pool: &sqlx::PgPool,
    client: &OpenRouterClient,
    model: &str,
    user_prompt: &str,
    assignment_title: &str,
    points_worth: Option<i32>,
    assignment_markdown: Option<&str>,
) -> Result<RubricDefinition, AppError> {
    let system = system_prompts::get_content_by_key(pool, ASSIGNMENT_RUBRIC_PROMPT_KEY)
        .await?
        .unwrap_or_else(|| FALLBACK_ASSIGNMENT_RUBRIC_SYSTEM_PROMPT.to_string());

    let points_line = match points_worth.filter(|p| *p > 0) {
        Some(p) => format!(
            "Assignment points worth (the rubric max total must match this exactly): {p} points.\n"
        ),
        None => "Assignment points worth: not set in the gradebook — choose sensible level points and a coherent total.\n".to_string(),
    };

    let assignment_block = assignment_markdown
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|md| format!("Full assignment instructions (Markdown):\n---\n{md}\n---\n\n",))
        .unwrap_or_default();

    let user_body = format!(
        "Assignment title (context): {}\n\
         {}\n\
         {assignment_block}\
         Instructor instructions for the rubric:\n---\n{}\n---\n\n\
         Respond with ONLY a JSON object as described in your system instructions (camelCase).",
        assignment_title.trim(),
        points_line,
        user_prompt.trim(),
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

    let rubric = parse_model_json(&text)?;
    crate::models::assignment_rubric::validate_rubric_definition(&rubric)?;
    crate::models::assignment_rubric::validate_rubric_against_points_worth(&rubric, points_worth)?;
    Ok(rubric)
}
