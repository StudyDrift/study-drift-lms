use regex::Regex;
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;

use crate::services::ai::{OpenRouterClient, OpenRouterError};

#[derive(Debug, Deserialize)]
struct AiScoreEnvelope {
    #[serde(default)]
    ai_probability: Option<f64>,
}

/// Returns AI-authorship probability in \[0, 100\].
pub async fn classify_ai_probability(
    client: &OpenRouterClient,
    model: &str,
    submission_text: &str,
) -> Result<Decimal, OpenRouterError> {
    let trimmed = submission_text.trim();
    if trimmed.len() < 40 {
        return Ok(Decimal::ZERO);
    }
    let capped = truncate_chars(trimmed, 12_000);
    let redacted = redact_pii(&capped);
    let messages = vec![
        json!({"role": "system", "content": "You estimate whether student-written academic prose was primarily authored by a generative AI. Reply with a single JSON object only: {\"aiProbability\": <number>} where aiProbability is 0-100 (not 0-1). Use heuristics only; this is an advisory signal for instructors."}),
        json!({"role": "user", "content": redacted}),
    ];
    let msg = client.chat_completion(model, &messages, &[]).await?;
    let body = msg.content.unwrap_or_default();
    let parsed: AiScoreEnvelope = parse_ai_json(&body).unwrap_or(AiScoreEnvelope {
        ai_probability: None,
    });
    let p = parsed.ai_probability.unwrap_or(0.0).clamp(0.0, 100.0);
    Ok(Decimal::try_from(p).unwrap_or(Decimal::ZERO))
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    s.chars().take(max_chars).collect()
}

fn redact_pii(text: &str) -> String {
    let email = Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b").unwrap();
    let phone = Regex::new(r"\b\+?\d[\d\s().-]{8,}\b").unwrap();
    let out = email.replace_all(text, "[redacted-email]");
    phone.replace_all(&out, "[redacted-phone]").into_owned()
}

fn parse_ai_json(body: &str) -> Option<AiScoreEnvelope> {
    let t = body.trim();
    let json_slice = if let (Some(i), Some(j)) = (t.find('{'), t.rfind('}')) {
        &t[i..=j]
    } else {
        t
    };
    let v: serde_json::Value = serde_json::from_str(json_slice).ok()?;
    let p = v
        .get("aiProbability")
        .or_else(|| v.get("ai_probability"))
        .and_then(|x| x.as_f64().or_else(|| x.as_i64().map(|i| i as f64)))?;
    Some(AiScoreEnvelope {
        ai_probability: Some(p),
    })
}
