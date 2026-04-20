use serde::{Deserialize, Serialize};

use crate::error::AppError;

const DEFAULT_JUDGE0_URL: &str = "http://localhost:2358";
const MAX_CODE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeTestCase {
    #[serde(default)]
    pub input: String,
    #[serde(default)]
    pub expected_output: String,
    #[serde(default)]
    pub is_hidden: bool,
    #[serde(default = "default_time_limit_ms")]
    pub time_limit_ms: i32,
    #[serde(default = "default_memory_limit_kb")]
    pub memory_limit_kb: i32,
}

fn default_time_limit_ms() -> i32 {
    2_000
}

fn default_memory_limit_kb() -> i32 {
    262_144
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodeExecutionStatus {
    Pass,
    Fail,
    Tle,
    Mle,
    Re,
    Ce,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeExecutionResult {
    pub status: CodeExecutionStatus,
    pub passed: bool,
    pub actual_output: String,
    pub expected_output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_ms: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_kb: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct ExecuteCodeRequest {
    pub language_id: i32,
    pub source_code: String,
    pub stdin: String,
    pub expected_output: String,
    pub time_limit_ms: i32,
    pub memory_limit_kb: i32,
}

#[derive(Debug, Deserialize)]
struct Judge0SubmitResponse {
    token: String,
}

#[derive(Debug, Deserialize)]
struct Judge0Status {
    id: i32,
}

#[derive(Debug, Deserialize)]
struct Judge0ResultResponse {
    status: Judge0Status,
    stdout: Option<String>,
    stderr: Option<String>,
    compile_output: Option<String>,
    time: Option<String>,
    memory: Option<i32>,
}

pub async fn run_code(req: ExecuteCodeRequest) -> Result<CodeExecutionResult, AppError> {
    validate_code_submission_size(&req.source_code)?;
    let client = reqwest::Client::new();
    let base = std::env::var("CODE_EXECUTION_API_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_JUDGE0_URL.to_string());
    let api_key = std::env::var("CODE_EXECUTION_API_KEY").ok();

    let submit_url = format!("{}/submissions?base64_encoded=false&wait=false", base.trim_end_matches('/'));
    let mut submit_req = client
        .post(submit_url)
        .json(&serde_json::json!({
            "language_id": req.language_id,
            "source_code": req.source_code,
            "stdin": req.stdin,
            "expected_output": req.expected_output,
            "cpu_time_limit": (req.time_limit_ms.max(100) as f64) / 1000.0,
            "memory_limit": req.memory_limit_kb.max(1024),
        }));
    if let Some(key) = api_key.as_ref() {
        submit_req = submit_req.header("X-Auth-Token", key);
    }
    let submit = submit_req
        .send()
        .await
        .map_err(|e| AppError::InvalidInput(format!("Code execution backend request failed: {e}")))?;
    if !submit.status().is_success() {
        let status = submit.status();
        let body = submit.text().await.unwrap_or_default();
        return Err(AppError::InvalidInput(format!(
            "Code execution backend rejected request ({status}): {body}"
        )));
    }
    let submitted: Judge0SubmitResponse = submit
        .json()
        .await
        .map_err(|e| AppError::InvalidInput(format!("Invalid code execution response: {e}")))?;

    let result_url = format!(
        "{}/submissions/{}?base64_encoded=false",
        base.trim_end_matches('/'),
        submitted.token
    );
    let mut attempts = 0usize;
    loop {
        attempts += 1;
        let mut poll_req = client.get(&result_url);
        if let Some(key) = api_key.as_ref() {
            poll_req = poll_req.header("X-Auth-Token", key);
        }
        let poll = poll_req
            .send()
            .await
            .map_err(|e| AppError::InvalidInput(format!("Code execution polling failed: {e}")))?;
        if !poll.status().is_success() {
            let status = poll.status();
            let body = poll.text().await.unwrap_or_default();
            return Err(AppError::InvalidInput(format!(
                "Code execution polling failed ({status}): {body}"
            )));
        }
        let out: Judge0ResultResponse = poll
            .json()
            .await
            .map_err(|e| AppError::InvalidInput(format!("Invalid code execution poll response: {e}")))?;

        if out.status.id <= 2 {
            if attempts >= 30 {
                return Ok(CodeExecutionResult {
                    status: CodeExecutionStatus::Tle,
                    passed: false,
                    actual_output: String::new(),
                    expected_output: req.expected_output,
                    stderr: Some("Execution timed out while waiting for backend response.".into()),
                    execution_ms: None,
                    memory_kb: None,
                });
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            continue;
        }
        let actual = normalize_output(out.stdout.unwrap_or_default());
        let expected = normalize_output(req.expected_output);
        let stderr = out.compile_output.or(out.stderr);
        let exec_ms = out
            .time
            .as_deref()
            .and_then(|s| s.parse::<f64>().ok())
            .map(|s| (s * 1000.0).round() as i32);
        let status = map_status(out.status.id, &actual, &expected);
        let passed = matches!(status, CodeExecutionStatus::Pass);
        return Ok(CodeExecutionResult {
            status,
            passed,
            actual_output: actual,
            expected_output: expected,
            stderr,
            execution_ms: exec_ms,
            memory_kb: out.memory,
        });
    }
}

pub fn language_id_from_name(language: &str) -> i32 {
    match language.trim().to_lowercase().as_str() {
        "python" | "python3" => 71,
        "java" => 62,
        "c" => 50,
        "c++" | "cpp" => 54,
        "javascript" | "js" => 63,
        "typescript" | "ts" => 74,
        "rust" => 73,
        "go" | "golang" => 60,
        "ruby" => 72,
        "sql" | "postgresql" => 82,
        _ => 63,
    }
}

pub fn validate_code_submission_size(code: &str) -> Result<(), AppError> {
    if code.as_bytes().len() > MAX_CODE_BYTES {
        return Err(AppError::InvalidInput(
            "Code submission exceeds 64 KB limit.".into(),
        ));
    }
    Ok(())
}

fn map_status(status_id: i32, actual: &str, expected: &str) -> CodeExecutionStatus {
    match status_id {
        3 => {
            if actual == expected {
                CodeExecutionStatus::Pass
            } else {
                CodeExecutionStatus::Fail
            }
        }
        5 => CodeExecutionStatus::Tle,
        6 => CodeExecutionStatus::Ce,
        7..=12 => CodeExecutionStatus::Re,
        13 => CodeExecutionStatus::Re,
        _ => CodeExecutionStatus::Fail,
    }
}

fn normalize_output(s: String) -> String {
    s.replace("\r\n", "\n").trim().to_string()
}
