//! OpenRouter HTTP client for chat-style image generation (`/api/v1/chat/completions`).
//!
//! See: <https://openrouter.ai/docs/guides/overview/multimodal/image-generation>

use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;

const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";

#[derive(Clone)]
pub struct OpenRouterClient {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
}

#[derive(Debug, Error)]
pub enum OpenRouterError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("OpenRouter returned {0}: {1}")]
    ApiStatus(u16, String),
    #[error("could not parse OpenRouter response: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no image in model response")]
    NoImageInResponse,
}

/// One model from OpenRouter [`GET /models`](https://openrouter.ai/docs/api/api-reference/models/get-models)
/// (filtered by `output_modalities`).
#[derive(Debug, Clone)]
pub struct ListedOpenRouterModel {
    pub id: String,
    pub name: String,
    pub context_length: Option<u64>,
    /// USD per 1M prompt tokens (input).
    pub input_price_per_million_usd: Option<f64>,
    /// USD per 1M completion tokens (output).
    pub output_price_per_million_usd: Option<f64>,
    pub modalities_summary: Option<String>,
}

#[derive(Deserialize)]
struct ModelsEnvelope {
    data: Vec<Value>,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChoiceBody>,
}

#[derive(Deserialize)]
struct ChoiceBody {
    message: AssistantMessage,
}

#[derive(Deserialize)]
struct AssistantMessage {
    images: Option<Vec<ImageItem>>,
}

#[derive(Deserialize)]
struct ImageItem {
    image_url: ImageUrlBody,
}

#[derive(Deserialize)]
struct ImageUrlBody {
    url: String,
}

impl OpenRouterClient {
    pub fn new(api_key: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key,
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    /// Returns a base64 data URL (`data:image/png;base64,...`).
    ///
    /// Retries on transient OpenRouter / upstream failures (502, 503, 429). BFL and other
    /// providers occasionally return 502 with `retry_after_seconds` in the JSON body.
    pub async fn generate_image(
        &self,
        model: &str,
        prompt: &str,
    ) -> Result<String, OpenRouterError> {
        const MAX_ATTEMPTS: u32 = 4;
        for attempt in 0..MAX_ATTEMPTS {
            match self.generate_image_once(model, prompt).await {
                Ok(url) => return Ok(url),
                Err(e) => {
                    if attempt + 1 < MAX_ATTEMPTS && is_retryable_openrouter_status(&e) {
                        let secs = retry_after_seconds_hint(&e).unwrap_or(1 + attempt as u64);
                        let secs = secs.min(12);
                        sleep(Duration::from_secs(secs)).await;
                        continue;
                    }
                    return Err(e);
                }
            }
        }
        unreachable!("generate_image retries always return inside the loop")
    }

    async fn generate_image_once(
        &self,
        model: &str,
        prompt: &str,
    ) -> Result<String, OpenRouterError> {
        let modalities = modalities_for_model(model);
        let body = serde_json::json!({
            "model": model,
            "messages": [{
                "role": "user",
                "content": prompt,
            }],
            "modalities": modalities,
            "stream": false,
        });

        let url = format!(
            "{}/chat/completions",
            self.base_url.trim_end_matches('/')
        );

        let res = self
            .http
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        let status = res.status();
        let text = res.text().await?;
        if !status.is_success() {
            return Err(OpenRouterError::ApiStatus(
                status.as_u16(),
                text.chars().take(2000).collect(),
            ));
        }

        let parsed: ChatCompletionResponse = serde_json::from_str(&text)?;
        let image_url = parsed
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.images)
            .and_then(|imgs| imgs.into_iter().next())
            .map(|i| i.image_url.url)
            .ok_or(OpenRouterError::NoImageInResponse)?;

        Ok(image_url)
    }
}

fn is_retryable_openrouter_status(e: &OpenRouterError) -> bool {
    matches!(
        e,
        OpenRouterError::ApiStatus(502 | 503 | 429, _)
    )
}

/// OpenRouter error bodies often include `error.metadata.retry_after_seconds`.
fn retry_after_seconds_hint(e: &OpenRouterError) -> Option<u64> {
    let OpenRouterError::ApiStatus(_, msg) = e else {
        return None;
    };
    let v: Value = serde_json::from_str(msg).ok()?;
    v.pointer("/error/metadata/retry_after_seconds")
        .and_then(|x| x.as_u64())
}

/// Lists models with the given output modality (`text`, `image`, etc.).
///
/// The models endpoint is **public** (no API key required). Keys are only needed for chat/completions
/// and other paid calls.
async fn list_models_by_output_modality(
    output_modality: &str,
) -> Result<Vec<ListedOpenRouterModel>, OpenRouterError> {
    let url = format!(
        "{}/models?output_modalities={}",
        DEFAULT_BASE_URL.trim_end_matches('/'),
        output_modality
    );
    let http = reqwest::Client::new();
    let res = http.get(url).send().await?;
    let status = res.status();
    let text = res.text().await?;
    if !status.is_success() {
        return Err(OpenRouterError::ApiStatus(
            status.as_u16(),
            text.chars().take(2000).collect(),
        ));
    }
    let envelope: ModelsEnvelope = serde_json::from_str(&text)?;
    let mut out = Vec::with_capacity(envelope.data.len());
    for row in envelope.data {
        let Some(id) = row.get("id").and_then(|v| v.as_str()).map(String::from) else {
            continue;
        };
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&id)
            .to_string();
        let context_length = row
            .get("context_length")
            .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|i| i as u64)));
        let pricing = row.get("pricing");
        let (input_price_per_million_usd, output_price_per_million_usd) =
            parse_prompt_completion_prices_million_usd(pricing);
        let modalities_summary = modalities_summary_from_row(&row);
        out.push(ListedOpenRouterModel {
            id,
            name,
            context_length,
            input_price_per_million_usd,
            output_price_per_million_usd,
            modalities_summary,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Text-to-text (chat) models: [`GET /models`](https://openrouter.ai/docs/api/api-reference/models/get-models)
/// with `output_modalities=text`.
pub async fn list_text_models() -> Result<Vec<ListedOpenRouterModel>, OpenRouterError> {
    list_models_by_output_modality("text").await
}

/// Image-capable models: `output_modalities=image`.
pub async fn list_image_models() -> Result<Vec<ListedOpenRouterModel>, OpenRouterError> {
    list_models_by_output_modality("image").await
}

/// `text+image -> image+text` style string from `architecture.input_modalities` / `output_modalities`.
fn modalities_summary_from_row(row: &Value) -> Option<String> {
    let arch = row.get("architecture")?;
    let in_s = arch
        .get("input_modalities")
        .and_then(|v| v.as_array())
        .map(|inputs| {
            inputs
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("+")
        })
        .unwrap_or_default();
    let out_s = arch
        .get("output_modalities")
        .and_then(|v| v.as_array())
        .map(|outputs| {
            outputs
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("+")
        })
        .unwrap_or_default();
    if in_s.is_empty() && out_s.is_empty() {
        return None;
    }
    Some(format!("{in_s} -> {out_s}"))
}

fn parse_prompt_completion_prices_million_usd(pricing: Option<&Value>) -> (Option<f64>, Option<f64>) {
    let Some(p) = pricing else {
        return (None, None);
    };
    let prompt = p.get("prompt").and_then(price_to_per_million_usd);
    let completion = p.get("completion").and_then(price_to_per_million_usd);
    (prompt, completion)
}

/// OpenRouter returns per-token USD as a string or number; convert to $/1M tokens.
fn price_to_per_million_usd(v: &Value) -> Option<f64> {
    let per_token = match v {
        Value::String(s) => s.parse::<f64>().ok()?,
        Value::Number(n) => n.as_f64()?,
        _ => return None,
    };
    Some(per_token * 1_000_000.0)
}

/// Image-only models expect `["image"]`; Gemini-style models use `["image", "text"]`.
fn modalities_for_model(model: &str) -> Vec<&'static str> {
    let m = model.to_lowercase();
    if m.contains("flux")
        || m.contains("sourceful")
        || m.contains("riverflow")
        || m.contains("black-forest-labs/")
    {
        vec!["image"]
    } else {
        vec!["image", "text"]
    }
}

/// One tool invocation from an assistant message (OpenAI-compatible chat completions).
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// Parsed assistant message from [`OpenRouterClient::chat_completion`].
#[derive(Debug, Default)]
pub struct ChatAssistantMessage {
    pub content: Option<String>,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Deserialize)]
struct ChatCompletionRaw {
    choices: Vec<ChatChoiceRaw>,
}

#[derive(Deserialize)]
struct ChatChoiceRaw {
    message: AssistantMessageRaw,
}

#[derive(Deserialize)]
struct AssistantMessageRaw {
    content: Option<String>,
    tool_calls: Option<Vec<ToolCallRaw>>,
}

#[derive(Deserialize)]
struct ToolCallRaw {
    id: String,
    #[serde(rename = "type")]
    _type: Option<String>,
    function: ToolCallFunctionRaw,
}

#[derive(Deserialize)]
struct ToolCallFunctionRaw {
    name: String,
    arguments: String,
}

impl OpenRouterClient {
    /// OpenAI-compatible chat completion with optional tools (function calling).
    pub async fn chat_completion(
        &self,
        model: &str,
        messages: &[Value],
        tools: &[Value],
    ) -> Result<ChatAssistantMessage, OpenRouterError> {
        let mut body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": false,
        });
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools);
            body["tool_choice"] = serde_json::json!("auto");
        }

        let url = format!(
            "{}/chat/completions",
            self.base_url.trim_end_matches('/')
        );

        let res = self
            .http
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        let status = res.status();
        let text = res.text().await?;
        if !status.is_success() {
            return Err(OpenRouterError::ApiStatus(
                status.as_u16(),
                text.chars().take(2000).collect(),
            ));
        }

        let parsed: ChatCompletionRaw = serde_json::from_str(&text)?;
        let choice = parsed.choices.into_iter().next().ok_or_else(|| {
            OpenRouterError::ApiStatus(500, "OpenRouter returned no choices.".into())
        })?;

        let msg = choice.message;
        let mut tool_calls = Vec::new();
        if let Some(raw_calls) = msg.tool_calls {
            for c in raw_calls {
                tool_calls.push(ToolCall {
                    id: c.id,
                    name: c.function.name,
                    arguments: c.function.arguments,
                });
            }
        }

        Ok(ChatAssistantMessage {
            content: msg.content,
            tool_calls,
        })
    }
}
