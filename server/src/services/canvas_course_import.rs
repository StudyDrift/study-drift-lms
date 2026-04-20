//! Build a [`CourseExportV1`] from the Canvas LMS REST API for `course_export_import::apply_import`.
//!
//! Tokens are used only for the duration of the request and must never be logged.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::OnceLock;

use chrono::{DateTime, Utc};
use tokio::sync::mpsc::UnboundedSender;
use regex::Regex;
use reqwest::Client;
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_export::{
    CanvasImportInclude, CourseExportSnapshot, CourseExportV1, ExportedAssignmentBody,
    ExportedContentPageBody, ExportedCourseEnrollment, ExportedQuizBody,
};
use crate::models::course_grading::{AssignmentGroupPublic, CourseGradingSettingsResponse};
use crate::models::course_module_quiz::QuizQuestion;
use crate::models::course_structure::CourseStructureItemResponse;
use crate::models::course_syllabus::SyllabusSection;
use crate::repos::course_module_external_links;

const EXPORT_FORMAT_VERSION: i32 = 1;
const CANVAS_PER_PAGE: &str = "100";

fn emit_progress(progress: Option<&UnboundedSender<String>>, message: &str) {
    let Some(tx) = progress else {
        return;
    };
    let Ok(payload) = serde_json::to_string(&serde_json::json!({
        "type": "progress",
        "message": message,
    })) else {
        return;
    };
    let _ = tx.send(payload);
}

fn re_br() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)<br\s*/?>").expect("regex"))
}

fn re_p_close() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)</p\s*>").expect("regex"))
}

fn re_tags() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"<[^>]+>").expect("regex"))
}

/// Strip Canvas HTML to plain text (fallback when HTML→Markdown conversion fails or is empty).
fn html_to_plain(html: &str) -> String {
    let s = re_br().replace_all(html, "\n");
    let s = re_p_close().replace_all(&s, "\n\n");
    let s = re_tags().replace_all(&s, "");
    let mut out = String::new();
    for line in s.lines() {
        let t = line.trim();
        if t.is_empty() {
            if out.ends_with("\n\n") || out.is_empty() {
                continue;
            }
            out.push('\n');
            continue;
        }
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(t);
        out.push('\n');
    }
    out.trim().to_string()
}

/// Canvas HTML → Markdown (headings, emphasis, lists, links, etc.).
/// Falls back to stripped plain text when conversion fails or returns nothing.
fn html_to_markdown(html: &str) -> String {
    if html.trim().is_empty() {
        return String::new();
    }
    match htmd::convert(html) {
        Ok(md) => {
            let out = md.trim().to_string();
            if out.is_empty() {
                html_to_plain(html)
            } else {
                out
            }
        }
        Err(_) => html_to_plain(html),
    }
}

fn host_allowed_by_suffix_policy(host: &str, allowed_host_suffixes: &[String]) -> bool {
    let host = host.to_ascii_lowercase();
    allowed_host_suffixes.iter().any(|suffix| {
        let suffix = suffix
            .trim()
            .trim_start_matches("*.")
            .trim_start_matches('.')
            .to_ascii_lowercase();
        host == suffix || host.ends_with(&format!(".{suffix}"))
    })
}

fn normalize_canvas_base_url(raw: &str, allowed_host_suffixes: &[String]) -> Result<String, AppError> {
    let t = raw.trim().trim_end_matches('/');
    if t.is_empty() {
        return Err(AppError::InvalidInput(
            "Canvas base URL is required.".into(),
        ));
    }
    let url = reqwest::Url::parse(t).map_err(|_| {
        AppError::InvalidInput("Canvas base URL must be a valid URL (https recommended).".into())
    })?;
    if url.scheme() != "https" {
        return Err(AppError::InvalidInput(
            "Canvas base URL must use https.".into(),
        ));
    }
    let Some(host) = url.host_str() else {
        return Err(AppError::InvalidInput(
            "Canvas base URL must include a hostname.".into(),
        ));
    };
    if host.parse::<IpAddr>().is_ok() {
        return Err(AppError::InvalidInput(
            "Canvas base URL must use a DNS hostname, not an IP address.".into(),
        ));
    }
    if !host_allowed_by_suffix_policy(host, allowed_host_suffixes) {
        return Err(AppError::InvalidInput(
            "Canvas base URL host is not allowed by server policy.".into(),
        ));
    }
    Ok(format!(
        "{}://{}{}",
        url.scheme(),
        host,
        url.path().trim_end_matches('/')
    ))
}

fn parse_canvas_course_id(raw: &str) -> Result<i64, AppError> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(AppError::InvalidInput(
            "Canvas course id is required.".into(),
        ));
    }
    t.parse::<i64>().map_err(|_| {
        AppError::InvalidInput(
            "Canvas course id must be a number (the id from the Canvas course URL).".into(),
        )
    })
}

fn json_datetime(v: Option<&Value>) -> Option<DateTime<Utc>> {
    let s = v?.as_str()?;
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn json_f64_as_i32_points(v: Option<&Value>) -> Option<i32> {
    let n = v?.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    let r = n.round();
    if r < 0.0 || r > i32::MAX as f64 {
        return None;
    }
    Some(r as i32)
}

fn json_string(v: Option<&Value>) -> Option<String> {
    v?.as_str().map(str::to_string)
}

fn normalize_canvas_email(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn canvas_enrollment_state_importable(row: &Value) -> bool {
    let s = row
        .get("enrollment_state")
        .and_then(|v| v.as_str())
        .unwrap_or("active");
    matches!(s, "active" | "invited" | "creation_pending")
}

/// Email/login on the small `user` object embedded on an enrollment (often has no email).
fn canvas_email_from_enrollment_user_stub(row: &Value) -> Option<String> {
    let user = row.get("user")?;
    if user.is_null() {
        return None;
    }
    json_string(user.get("email"))
        .filter(|e| e.contains('@'))
        .map(|e| normalize_canvas_email(&e))
        .or_else(|| {
            json_string(user.get("login_id"))
                .filter(|e| e.contains('@'))
                .map(|e| normalize_canvas_email(&e))
        })
}

#[derive(Clone, Default)]
struct CanvasRosterContact {
    display_name: Option<String>,
    email: Option<String>,
    login_id: Option<String>,
}

impl CanvasRosterContact {
    fn resolve_import_email(&self, canvas_user_id: i64) -> String {
        if let Some(ref e) = self.email {
            let e = normalize_canvas_email(e);
            if !e.is_empty() && e.contains('@') {
                return e;
            }
        }
        if let Some(ref login) = self.login_id {
            let t = login.trim();
            if t.contains('@') {
                return normalize_canvas_email(t);
            }
            if !t.is_empty() {
                let frag = sanitize_canvas_login_for_email(t);
                if !frag.is_empty() {
                    return format!("{frag}-{canvas_user_id}@canvas-roster.imported");
                }
            }
        }
        format!("canvas-user-{canvas_user_id}@canvas-roster.imported")
    }
}

fn sanitize_canvas_login_for_email(raw: &str) -> String {
    let mut out: String = raw
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' | '+' => c.to_ascii_lowercase(),
            _ => '_',
        })
        .take(72)
        .collect();
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}

fn canvas_user_row_to_contact(u: &Value) -> Option<(i64, CanvasRosterContact)> {
    let id = json_i64(u.get("id"))?;
    let email = json_string(u.get("email"))
        .filter(|e| e.contains('@'))
        .map(|e| normalize_canvas_email(&e));
    let login_id = json_string(u.get("login_id")).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let display_name = json_string(u.get("name"))
        .or_else(|| json_string(u.get("short_name")))
        .or_else(|| json_string(u.get("sortable_name")))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Some((
        id,
        CanvasRosterContact {
            display_name,
            email,
            login_id,
        },
    ))
}

#[derive(Clone)]
struct CanvasRoleGrant {
    role: String,
    instructor_grant_role: Option<String>,
    display_hint: Option<String>,
}

fn canvas_enrollment_rows_to_role_map(rows: &[Value]) -> HashMap<i64, CanvasRoleGrant> {
    let mut best: HashMap<i64, CanvasRoleGrant> = HashMap::new();
    for row in rows {
        if !canvas_enrollment_state_importable(row) {
            continue;
        }
        let Some(user_id) = json_i64(row.get("user_id"))
            .or_else(|| row.get("user").and_then(|u| json_i64(u.get("id"))))
        else {
            continue;
        };
        let type_str = row.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let canvas_role = row.get("role").and_then(|v| v.as_str());
        let Some((role, grant)) = canvas_enrollment_type_to_lex(type_str, canvas_role) else {
            continue;
        };

        let incoming = CanvasRoleGrant {
            role: role.to_string(),
            instructor_grant_role: grant.map(str::to_string),
            display_hint: canvas_enrollment_user_display_name(row),
        };

        best.entry(user_id)
            .and_modify(|cur| {
                let r_cur = lex_enrollment_rank(cur.role.as_str());
                let r_new = lex_enrollment_rank(incoming.role.as_str());
                if r_new < r_cur {
                    *cur = incoming.clone();
                } else if r_new == r_cur && incoming.role == "instructor" {
                    if instructor_grant_rank(cur.instructor_grant_role.as_deref())
                        > instructor_grant_rank(incoming.instructor_grant_role.as_deref())
                    {
                        *cur = incoming.clone();
                    }
                }
                if cur.display_hint.is_none() {
                    cur.display_hint.clone_from(&incoming.display_hint);
                }
            })
            .or_insert(incoming);
    }
    best
}

fn canvas_build_enrollments_from_canvas_data(
    enrollment_rows: &[Value],
    course_user_rows: &[Value],
) -> Vec<ExportedCourseEnrollment> {
    let role_map = canvas_enrollment_rows_to_role_map(enrollment_rows);
    let mut contacts: HashMap<i64, CanvasRosterContact> = HashMap::new();
    for u in course_user_rows {
        if let Some((id, c)) = canvas_user_row_to_contact(u) {
            contacts.insert(id, c);
        }
    }

    let mut keys: Vec<i64> = contacts
        .keys()
        .chain(role_map.keys())
        .copied()
        .collect();
    keys.sort_unstable();
    keys.dedup();

    let mut out: Vec<ExportedCourseEnrollment> = Vec::with_capacity(keys.len());
    for uid in keys {
        let contact = contacts.get(&uid).cloned().unwrap_or_default();
        let rg = role_map.get(&uid);
        let role = rg
            .map(|r| r.role.as_str())
            .unwrap_or("student")
            .to_string();
        let instructor_grant_role = rg.and_then(|r| r.instructor_grant_role.clone());
        let display_from_role = rg.and_then(|r| r.display_hint.clone());

        let email = if contacts.contains_key(&uid) {
            contact.resolve_import_email(uid)
        } else {
            enrollment_rows
                .iter()
                .find(|r| json_i64(r.get("user_id")) == Some(uid))
                .and_then(canvas_email_from_enrollment_user_stub)
                .unwrap_or_else(|| format!("canvas-user-{uid}@canvas-roster.imported"))
        };

        let display_name = contact
            .display_name
            .clone()
            .or(display_from_role);

        out.push(ExportedCourseEnrollment {
            email,
            role,
            instructor_grant_role,
            display_name,
        });
    }
    out.sort_by(|a, b| a.email.cmp(&b.email));
    out
}

async fn canvas_fetch_course_users_for_roster(
    client: &Client,
    base: &str,
    token: &str,
    cid_str: &str,
) -> Result<Vec<Value>, AppError> {
    let base_query = [
        ("enrollment_state[]", "active"),
        ("enrollment_state[]", "invited"),
    ];
    match canvas_get_json_array_paginated(
        client,
        base,
        token,
        &["courses", cid_str, "users"],
        &[base_query[0], base_query[1], ("include[]", "email")],
    )
    .await
    {
        Ok(v) => Ok(v),
        Err(_) => {
            canvas_get_json_array_paginated(
                client,
                base,
                token,
                &["courses", cid_str, "users"],
                &base_query,
            )
            .await
        }
    }
}

fn canvas_enrollment_user_display_name(row: &Value) -> Option<String> {
    let user = row.get("user")?;
    if user.is_null() {
        return None;
    }
    json_string(user.get("name"))
        .or_else(|| json_string(user.get("short_name")))
        .or_else(|| json_string(user.get("sortable_name")))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Canvas `type` (e.g. `TeacherEnrollment`) → Lexters enrollment role + optional RBAC catalog for staff grants.
fn canvas_enrollment_type_to_lex(
    type_str: &str,
    canvas_role: Option<&str>,
) -> Option<(&'static str, Option<&'static str>)> {
    match type_str {
        "StudentEnrollment" => Some(("student", None)),
        "TaEnrollment" => Some(("instructor", Some("TA"))),
        "TeacherEnrollment" => Some(("instructor", Some("Teacher"))),
        "DesignerEnrollment" => Some(("instructor", Some("TA"))),
        "ObserverEnrollment" => Some(("student", None)),
        _ => {
            let r = canvas_role.unwrap_or("").to_ascii_lowercase();
            if r.contains("teacher") || r == "teacherenrollment" {
                return Some(("instructor", Some("Teacher")));
            }
            if r.contains("ta") || r.contains("assistant") {
                return Some(("instructor", Some("TA")));
            }
            if r.contains("designer") {
                return Some(("instructor", Some("TA")));
            }
            if r.contains("observer") {
                return Some(("student", None));
            }
            if r.contains("student") || r.contains("learner") {
                return Some(("student", None));
            }
            None
        }
    }
}

fn lex_enrollment_rank(role: &str) -> i32 {
    match role {
        "instructor" | "teacher" => 0,
        "student" => 1,
        _ => 2,
    }
}

fn instructor_grant_rank(grant: Option<&str>) -> i32 {
    match grant {
        Some("Teacher") => 0,
        Some("TA") => 1,
        _ => 2,
    }
}

/// Canvas ids are usually JSON numbers; tolerate string ids.
fn json_i64(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    if let Some(i) = v.as_i64() {
        return Some(i);
    }
    if let Some(u) = v.as_u64() {
        return i64::try_from(u).ok();
    }
    v.as_str().and_then(|s| s.trim().parse().ok())
}

fn canvas_api_url(base: &str, segments: &[&str], query: &[(&str, &str)]) -> Result<reqwest::Url, AppError> {
    let root = base.trim_end_matches('/');
    let path = segments.join("/");
    let mut url = reqwest::Url::parse(&format!("{}/api/v1/{}", root, path)).map_err(|_| {
        AppError::InvalidInput("Invalid Canvas base URL or API path.".into())
    })?;
    if !query.is_empty() {
        let mut qp = url.query_pairs_mut();
        for (k, v) in query {
            qp.append_pair(k, v);
        }
    }
    Ok(url)
}

async fn canvas_get_json_url(client: &Client, url: reqwest::Url, token: &str) -> Result<Value, AppError> {
    let resp = client
        .get(url)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", token.trim()),
        )
        .send()
        .await
        .map_err(|e| {
            AppError::InvalidInput(format!(
                "Could not reach Canvas (network error). Check the base URL and try again. ({e})"
            ))
        })?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| {
        AppError::InvalidInput(format!("Failed to read Canvas response: {e}"))
    })?;
    if !status.is_success() {
        let snippet = String::from_utf8_lossy(&bytes[..bytes.len().min(400)]);
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::InvalidInput(
                "Canvas rejected the access token (401). Create a token with read access to courses, modules, assignments, enrollments, and the course roster (users), then try again."
                    .into(),
            ));
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::InvalidInput(
                "Canvas returned 404 for this course or endpoint. Check the course id and token scope."
                    .into(),
            ));
        }
        return Err(AppError::InvalidInput(format!(
            "Canvas API error HTTP {}: {}",
            status.as_u16(),
            snippet.trim()
        )));
    }
    serde_json::from_slice(&bytes).map_err(|e| {
        AppError::InvalidInput(format!("Canvas returned invalid JSON: {e}"))
    })
}

/// Paginated GET where Canvas returns a JSON array per page (`?page=`).
async fn canvas_get_json_array_paginated(
    client: &Client,
    base: &str,
    token: &str,
    segments: &[&str],
    extra_query: &[(&str, &str)],
) -> Result<Vec<Value>, AppError> {
    let per_page: usize = CANVAS_PER_PAGE.parse().unwrap_or(100);
    let root = base.trim_end_matches('/');
    let path = segments.join("/");
    let mut out = Vec::new();
    let mut page: u32 = 1;
    loop {
        let mut url = reqwest::Url::parse(&format!("{}/api/v1/{}", root, path))
            .map_err(|_| AppError::InvalidInput("Invalid Canvas URL.".into()))?;
        {
            let mut qp = url.query_pairs_mut();
            for (k, v) in extra_query {
                qp.append_pair(k, v);
            }
            qp.append_pair("per_page", CANVAS_PER_PAGE);
            qp.append_pair("page", &page.to_string());
        }
        let arr = canvas_get_json_url(client, url, token).await?;
        let items = arr
            .as_array()
            .ok_or_else(|| AppError::InvalidInput("Unexpected Canvas response (expected array).".into()))?;
        if items.is_empty() {
            break;
        }
        let n = items.len();
        out.extend(items.iter().cloned());
        if n < per_page {
            break;
        }
        page += 1;
    }
    Ok(out)
}

/// `tail` is the path after `/courses/{cid}/`, e.g. `pages/home` or `assignments/42`.
fn canvas_course_subresource_url(base: &str, cid: i64, tail: &str) -> Result<reqwest::Url, AppError> {
    let root = base.trim_end_matches('/');
    let tail = tail.trim_start_matches('/');
    reqwest::Url::parse(&format!("{}/api/v1/courses/{cid}/{tail}", root)).map_err(|_| {
        AppError::InvalidInput("Invalid Canvas API URL (check base URL and resource path).".into())
    })
}

/// Module items are often omitted from `GET /modules` even with `include[]=items`; this endpoint is authoritative.
async fn canvas_fetch_module_items(
    client: &Client,
    base: &str,
    token: &str,
    cid: i64,
    canvas_module_id: i64,
) -> Result<Vec<Value>, AppError> {
    let cid_s = cid.to_string();
    let mid_s = canvas_module_id.to_string();
    let segments = ["courses", &cid_s, "modules", &mid_s, "items"];
    canvas_get_json_array_paginated(client, base, token, &segments, &[]).await
}

/// Percent-encode for Canvas query/path segments (ASCII subset).
fn pct_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn canvas_question_to_quiz_question(q: &Value) -> Option<QuizQuestion> {
    let id = q.get("id")?.as_i64()?;
    let qtype = q.get("question_type")?.as_str()?;
    let prompt_html = q.get("question_text").and_then(|v| v.as_str()).unwrap_or("");
    let mut prompt = html_to_markdown(prompt_html);
    if prompt.is_empty() {
        prompt = q
            .get("question_name")
            .and_then(|v| v.as_str())
            .unwrap_or("Question")
            .to_string();
    }

    let answers: Vec<Value> = q
        .get("answers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    match qtype {
        "multiple_choice_question" | "multiple_answers_question" => {
            let choices: Vec<String> = answers
                .iter()
                .filter_map(|a| a.get("text").and_then(|t| t.as_str()).map(html_to_markdown))
                .collect();
            if choices.is_empty() {
                return Some(QuizQuestion {
                    id: format!("canvas-{id}"),
                    prompt,
                    question_type: "essay".into(),
                    choices: vec![],
                    type_config: serde_json::json!({}),
                    correct_choice_index: None,
                    multiple_answer: false,
                    answer_with_image: false,
                    required: true,
                    points: json_f64_as_i32_points(q.get("points_possible")).unwrap_or(1).max(0),
                    estimated_minutes: 2,
                });
            }
            let mut best_i: Option<usize> = None;
            let mut best_w = -1.0_f64;
            for (i, a) in answers.iter().enumerate() {
                let w = a.get("weight").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if w > best_w {
                    best_w = w;
                    best_i = Some(i);
                }
            }
            Some(QuizQuestion {
                id: format!("canvas-{id}"),
                prompt,
                question_type: "multiple_choice".into(),
                choices,
                type_config: serde_json::json!({}),
                correct_choice_index: best_i,
                multiple_answer: qtype == "multiple_answers_question",
                answer_with_image: false,
                required: true,
                points: json_f64_as_i32_points(q.get("points_possible")).unwrap_or(1).max(0),
                estimated_minutes: 2,
            })
        }
        "true_false_question" => {
            let choices = vec!["True".to_string(), "False".to_string()];
            let correct = answers.iter().position(|a| {
                a.get("weight")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0)
                    > 0.0
            });
            Some(QuizQuestion {
                id: format!("canvas-{id}"),
                prompt,
                question_type: "true_false".into(),
                choices,
                type_config: serde_json::json!({}),
                correct_choice_index: correct,
                multiple_answer: false,
                answer_with_image: false,
                required: true,
                points: json_f64_as_i32_points(q.get("points_possible")).unwrap_or(1).max(0),
                estimated_minutes: 1,
            })
        }
        "short_answer_question" => Some(QuizQuestion {
            id: format!("canvas-{id}"),
            prompt,
            question_type: "short_answer".into(),
            choices: vec![],
            type_config: serde_json::json!({}),
            correct_choice_index: None,
            multiple_answer: false,
            answer_with_image: false,
            required: true,
            points: json_f64_as_i32_points(q.get("points_possible")).unwrap_or(1).max(0),
            estimated_minutes: 3,
        }),
        "essay_question" => Some(QuizQuestion {
            id: format!("canvas-{id}"),
            prompt,
            question_type: "essay".into(),
            choices: vec![],
            type_config: serde_json::json!({}),
            correct_choice_index: None,
            multiple_answer: false,
            answer_with_image: false,
            required: true,
            points: json_f64_as_i32_points(q.get("points_possible")).unwrap_or(1).max(0),
            estimated_minutes: 10,
        }),
        "fill_in_multiple_blanks_question" | "fill_in_blank_question" => Some(QuizQuestion {
            id: format!("canvas-{id}"),
            prompt,
            question_type: "fill_in_blank".into(),
            choices: vec![],
            type_config: serde_json::json!({}),
            correct_choice_index: None,
            multiple_answer: false,
            answer_with_image: false,
            required: true,
            points: json_f64_as_i32_points(q.get("points_possible")).unwrap_or(1).max(0),
            estimated_minutes: 3,
        }),
        _ => Some(QuizQuestion {
            id: format!("canvas-{id}"),
            prompt: format!("{prompt}\n\n_(Imported from Canvas as an essay: original type was `{qtype}`.)_"),
            question_type: "essay".into(),
            choices: vec![],
            type_config: serde_json::json!({}),
            correct_choice_index: None,
            multiple_answer: false,
            answer_with_image: false,
            required: true,
            points: json_f64_as_i32_points(q.get("points_possible")).unwrap_or(1).max(0),
            estimated_minutes: 10,
        }),
    }
}

#[allow(clippy::too_many_arguments)]
async fn canvas_export_append_assignment_details(
    client: &Client,
    base: &str,
    token: &str,
    cid: i64,
    aid: i64,
    title: String,
    item_published: bool,
    parent_module_id: Uuid,
    sort_order: &mut i32,
    now: DateTime<Utc>,
    map_grading_groups: bool,
    canvas_ag_to_lex: &HashMap<i64, Uuid>,
    structure: &mut Vec<CourseStructureItemResponse>,
    assignments: &mut HashMap<Uuid, ExportedAssignmentBody>,
    progress: Option<&UnboundedSender<String>>,
    emit_first_fetch_msg: &mut bool,
) -> Result<(), AppError> {
    if *emit_first_fetch_msg {
        emit_progress(progress, "Reading assignment details from Canvas…");
        *emit_first_fetch_msg = false;
    }
    let Ok(a_url) = canvas_course_subresource_url(base, cid, &format!("assignments/{aid}")) else {
        return Ok(());
    };
    let aj = match canvas_get_json_url(client, a_url, token).await {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let desc_html = aj.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let markdown = html_to_markdown(desc_html);
    let due_at = json_datetime(aj.get("due_at"));
    let available_from = json_datetime(aj.get("unlock_at"));
    let available_until = json_datetime(aj.get("lock_at"));
    let mut submission_allow_text = false;
    let mut submission_allow_file_upload = false;
    let mut submission_allow_url = false;
    if let Some(arr) = aj.get("submission_types").and_then(|v| v.as_array()) {
        for v in arr {
            if let Some(s) = v.as_str() {
                match s {
                    "online_text_entry" => submission_allow_text = true,
                    "online_upload" => submission_allow_file_upload = true,
                    "online_url" => submission_allow_url = true,
                    _ => {}
                }
            }
        }
    }
    if !submission_allow_text && !submission_allow_file_upload && !submission_allow_url {
        submission_allow_text = true;
    }
    let points_worth = json_f64_as_i32_points(aj.get("points_possible"));
    let assignment_group_id = if map_grading_groups {
        let canvas_gid = json_i64(aj.get("assignment_group_id"));
        canvas_gid
            .and_then(|g| canvas_ag_to_lex.get(&g).copied())
            .or_else(|| canvas_ag_to_lex.values().next().copied())
    } else {
        None
    };
    let aid_lex = Uuid::new_v4();
    structure.push(CourseStructureItemResponse {
        id: aid_lex,
        sort_order: *sort_order,
        kind: "assignment".into(),
        title,
        parent_id: Some(parent_module_id),
        published: item_published,
        visible_from: None,
        archived: false,
        due_at,
        assignment_group_id,
        created_at: now,
        updated_at: now,
        is_adaptive: None,
        points_possible: None,
        points_worth,
        external_url: None,
    });
    assignments.insert(
        aid_lex,
        ExportedAssignmentBody {
            markdown,
            due_at,
            points_worth,
            available_from,
            available_until,
            assignment_access_code: None,
            submission_allow_text,
            submission_allow_file_upload,
            submission_allow_url,
            late_submission_policy: "allow".into(),
            late_penalty_percent: None,
            rubric: None,
        },
    );
    *sort_order += 1;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn canvas_export_append_quiz_details(
    client: &Client,
    base: &str,
    token: &str,
    cid: i64,
    cid_str: &str,
    qid: i64,
    title: String,
    item_published: bool,
    parent_module_id: Uuid,
    sort_order: &mut i32,
    now: DateTime<Utc>,
    map_grading_groups: bool,
    canvas_ag_to_lex: &HashMap<i64, Uuid>,
    structure: &mut Vec<CourseStructureItemResponse>,
    quizzes: &mut HashMap<Uuid, ExportedQuizBody>,
    progress: Option<&UnboundedSender<String>>,
    emit_first_quiz_msg: &mut bool,
    emit_first_questions_msg: &mut bool,
) -> Result<(), AppError> {
    if *emit_first_quiz_msg {
        emit_progress(progress, "Reading quiz details from Canvas…");
        *emit_first_quiz_msg = false;
    }
    let Ok(q_url) = canvas_course_subresource_url(base, cid, &format!("quizzes/{qid}")) else {
        return Ok(());
    };
    let qj = match canvas_get_json_url(client, q_url, token).await {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let desc_html = qj.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let markdown = html_to_markdown(desc_html);
    let due_at = json_datetime(qj.get("due_at"));
    let available_from = json_datetime(qj.get("unlock_at"));
    let available_until = json_datetime(qj.get("lock_at"));
    let points_worth = json_f64_as_i32_points(qj.get("points_possible"));
    let assignment_group_id = if map_grading_groups {
        let canvas_gid = json_i64(qj.get("assignment_group_id"));
        canvas_gid
            .and_then(|g| canvas_ag_to_lex.get(&g).copied())
            .or_else(|| canvas_ag_to_lex.values().next().copied())
    } else {
        None
    };
    let time_limit_minutes = qj
        .get("time_limit")
        .and_then(|v| v.as_i64())
        .filter(|&m| m > 0)
        .map(|m| m as i32);
    let allowed = qj.get("allowed_attempts").and_then(|v| v.as_i64()).unwrap_or(1);
    let unlimited_attempts = allowed < 0;
    let max_attempts = if unlimited_attempts {
        1
    } else {
        allowed.clamp(1, 100) as i32
    };

    let qid_str = qid.to_string();
    if *emit_first_questions_msg {
        emit_progress(progress, "Loading quiz questions from Canvas…");
        *emit_first_questions_msg = false;
    }
    let questions_json = canvas_get_json_array_paginated(
        client,
        base,
        token,
        &["courses", cid_str, "quizzes", &qid_str, "questions"],
        &[],
    )
    .await
    .unwrap_or_default();
    let mut questions: Vec<QuizQuestion> = Vec::new();
    for row in questions_json {
        if let Some(qq) = canvas_question_to_quiz_question(&row) {
            questions.push(qq);
        }
    }

    let qlex = Uuid::new_v4();
    structure.push(CourseStructureItemResponse {
        id: qlex,
        sort_order: *sort_order,
        kind: "quiz".into(),
        title,
        parent_id: Some(parent_module_id),
        published: item_published,
        visible_from: None,
        archived: false,
        due_at,
        assignment_group_id,
        created_at: now,
        updated_at: now,
        is_adaptive: Some(false),
        points_possible: None,
        points_worth,
        external_url: None,
    });
    quizzes.insert(
        qlex,
        ExportedQuizBody {
            markdown,
            due_at,
            available_from,
            available_until,
            unlimited_attempts,
            max_attempts,
            grade_attempt_policy: "latest".into(),
            passing_score_percent: None,
            points_worth,
            late_submission_policy: "allow".into(),
            late_penalty_percent: None,
            time_limit_minutes,
            timer_pause_when_tab_hidden: false,
            per_question_time_limit_seconds: None,
            show_score_timing: "immediate".into(),
            review_visibility: "full".into(),
            review_when: "always".into(),
            one_question_at_a_time: false,
            shuffle_questions: false,
            shuffle_choices: false,
            allow_back_navigation: true,
            lockdown_mode: "standard".into(),
            focus_loss_threshold: None,
            quiz_access_code: None,
            adaptive_difficulty: "standard".into(),
            adaptive_topic_balance: true,
            adaptive_stop_rule: "fixed_count".into(),
            random_question_pool_count: None,
            questions,
            is_adaptive: false,
            adaptive_system_prompt: String::new(),
            adaptive_source_item_ids: vec![],
            adaptive_question_count: 5,
        },
    );
    *sort_order += 1;
    Ok(())
}

/// Fetches a Canvas course and builds an export bundle compatible with [`crate::services::course_export_import::apply_import`].
pub async fn build_export_from_canvas(
    client: &Client,
    canvas_base_url: &str,
    canvas_course_id: i64,
    access_token: &str,
    include: CanvasImportInclude,
    allowed_host_suffixes: &[String],
    progress: Option<&UnboundedSender<String>>,
) -> Result<CourseExportV1, AppError> {
    let token = access_token.trim();
    if token.is_empty() {
        return Err(AppError::InvalidInput(
            "Canvas access token is required.".into(),
        ));
    }
    emit_progress(progress, "Connecting to Canvas…");
    let base = normalize_canvas_base_url(canvas_base_url, allowed_host_suffixes)?;
    let cid = canvas_course_id;
    let cid_str = cid.to_string();

    let course_url = canvas_api_url(
        &base,
        &["courses", &cid_str],
        &[("include[]", "syllabus_body")],
    )?;
    let course = canvas_get_json_url(client, course_url, token).await?;
    emit_progress(progress, "Loaded course details from Canvas.");

    let map_grading_groups = include.grades;

    let (title, description, syllabus, starts_at, ends_at, published) = if include.settings {
        let title = json_string(course.get("name"))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Imported Canvas course".to_string());

        let desc_html = course
            .get("public_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let syllabus_html = course.get("syllabus_body").and_then(|v| v.as_str()).unwrap_or("");
        let description = if !desc_html.trim().is_empty() {
            html_to_markdown(desc_html)
        } else {
            html_to_markdown(syllabus_html)
        };

        let starts_at = json_datetime(course.get("start_at"));
        let ends_at = json_datetime(course.get("end_at"));
        let published = course
            .get("workflow_state")
            .and_then(|v| v.as_str())
            .map(|s| s == "available")
            .unwrap_or(true);

        let mut syllabus = Vec::new();
        if !syllabus_html.trim().is_empty() {
            syllabus.push(SyllabusSection {
                id: "canvas-syllabus".into(),
                heading: "Syllabus".into(),
                markdown: html_to_markdown(syllabus_html),
            });
        } else if !desc_html.trim().is_empty() {
            // `syllabus_body` is omitted unless explicitly included; many courses only have `public_description`.
            syllabus.push(SyllabusSection {
                id: "canvas-course-overview".into(),
                heading: "Course overview".into(),
                markdown: html_to_markdown(desc_html),
            });
        }
        (title, description, syllabus, starts_at, ends_at, published)
    } else {
        (
            "Canvas course".into(),
            String::new(),
            Vec::new(),
            None,
            None,
            true,
        )
    };

    let mut canvas_ag_to_lex: HashMap<i64, Uuid> = HashMap::new();
    let mut assignment_groups: Vec<AssignmentGroupPublic> = Vec::new();
    if map_grading_groups {
        emit_progress(progress, "Loading assignment groups…");
        let ag_rows = canvas_get_json_array_paginated(
            client,
            &base,
            token,
            &["courses", &cid_str, "assignment_groups"],
            &[],
        )
        .await?;
        emit_progress(progress, "Loaded assignment groups.");

        for (idx, row) in ag_rows.iter().enumerate() {
            let Some(canvas_id) = json_i64(row.get("id")) else {
                continue;
            };
            let lex = Uuid::new_v4();
            canvas_ag_to_lex.insert(canvas_id, lex);
            let name = json_string(row.get("name")).unwrap_or_else(|| "Assignments".to_string());
            let sort_order_ag = row
                .get("position")
                .and_then(|v| v.as_i64())
                .unwrap_or((idx + 1) as i64) as i32;
            let weight = row
                .get("group_weight")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                .clamp(0.0, 100.0);
            assignment_groups.push(AssignmentGroupPublic {
                id: lex,
                sort_order: sort_order_ag,
                name,
                weight_percent: weight,
            });
        }
        if assignment_groups.is_empty() {
            let lex = Uuid::new_v4();
            assignment_groups.push(AssignmentGroupPublic {
                id: lex,
                sort_order: 1,
                name: "Imported".into(),
                weight_percent: 100.0,
            });
        }
    }

    let grading = CourseGradingSettingsResponse {
        grading_scale: "percent".into(),
        assignment_groups,
    };

    let mut modules_sorted: Vec<Value> = Vec::new();
    if include.modules {
        emit_progress(progress, "Loading all modules…");
        let modules = canvas_get_json_array_paginated(
            client,
            &base,
            token,
            &["courses", &cid_str, "modules"],
            &[("include[]", "items")],
        )
        .await?;
        modules_sorted = modules;
        modules_sorted.sort_by_key(|m| {
            m.get("position")
                .and_then(|v| v.as_i64())
                .unwrap_or(9999)
        });
    }

    let now = Utc::now();
    let mut structure: Vec<CourseStructureItemResponse> = Vec::new();
    let mut content_pages: HashMap<Uuid, ExportedContentPageBody> = HashMap::new();
    let mut assignments: HashMap<Uuid, ExportedAssignmentBody> = HashMap::new();
    let mut quizzes: HashMap<Uuid, ExportedQuizBody> = HashMap::new();
    let mut sort_order: i32 = 0;

    let mut first_wiki_msg = true;
    let mut first_assignment_msg = true;
    let mut first_quiz_msg = true;
    let mut first_quiz_questions_msg = true;
    let mut first_discussion_msg = true;

    if include.modules {
        emit_progress(
            progress,
            "Reading module items (pages, assignments, quizzes, discussions)…",
        );
    }

    for m in modules_sorted {
        let module_title = json_string(m.get("name")).unwrap_or_else(|| "Module".to_string());
        emit_progress(
            progress,
            &format!("Scanning module: {module_title}"),
        );
        let module_published = m
            .get("published")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let module_id = Uuid::new_v4();
        structure.push(CourseStructureItemResponse {
            id: module_id,
            sort_order,
            kind: "module".into(),
            title: module_title,
            parent_id: None,
            published: module_published,
            visible_from: None,
            archived: false,
            due_at: None,
            assignment_group_id: None,
            created_at: now,
            updated_at: now,
            is_adaptive: None,
            points_possible: None,
            points_worth: None,
            external_url: None,
        });
        sort_order += 1;

        let mut items: Vec<Value> = m
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if items.is_empty() {
            if let Some(mid) = json_i64(m.get("id")) {
                if let Ok(fetched) =
                    canvas_fetch_module_items(client, &base, token, cid, mid).await
                {
                    items = fetched;
                }
            }
        }
        items.sort_by_key(|it| {
            it.get("position")
                .and_then(|v| v.as_i64())
                .unwrap_or(9999)
        });

        for item in items {
            let title = json_string(item.get("title")).unwrap_or_else(|| "Item".to_string());
            let item_published = item
                .get("published")
                .and_then(|v| v.as_bool())
                .unwrap_or(module_published);
            let html_url = json_string(item.get("html_url")).unwrap_or_default();
            let type_str = item.get("type").and_then(|v| v.as_str()).unwrap_or("");

            match type_str {
                "SubHeader" => {
                    let hid = Uuid::new_v4();
                    structure.push(CourseStructureItemResponse {
                        id: hid,
                        sort_order,
                        kind: "heading".into(),
                        title,
                        parent_id: Some(module_id),
                        published: item_published,
                        visible_from: None,
                        archived: false,
                        due_at: None,
                        assignment_group_id: None,
                        created_at: now,
                        updated_at: now,
                        is_adaptive: None,
                        points_possible: None,
                        points_worth: None,
                        external_url: None,
                    });
                    sort_order += 1;
                }
                "Page" => {
                    if first_wiki_msg {
                        emit_progress(progress, "Reading wiki page content from Canvas…");
                        first_wiki_msg = false;
                    }
                    let page_slug: Option<String> = item
                        .get("page_url")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .or_else(|| {
                            item.get("url")
                                .and_then(|v| v.as_str())
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(String::from)
                        })
                        .or_else(|| json_i64(item.get("content_id")).map(|id| id.to_string()));
                    let Some(page_slug) = page_slug else { continue };
                    let enc = page_slug
                        .split('/')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(pct_encode)
                        .collect::<Vec<_>>()
                        .join("/");
                    let Ok(page_u) =
                        canvas_course_subresource_url(&base, cid, &format!("pages/{enc}"))
                    else {
                        continue;
                    };
                    let page_json = match canvas_get_json_url(client, page_u, token).await {
                        Ok(v) => v,
                        Err(_) => {
                            let pid = Uuid::new_v4();
                            let markdown = format!(
                                "_The Canvas wiki page `{page_slug}` could not be loaded (check token permissions or page visibility)._"
                            );
                            structure.push(CourseStructureItemResponse {
                                id: pid,
                                sort_order,
                                kind: "content_page".into(),
                                title,
                                parent_id: Some(module_id),
                                published: item_published,
                                visible_from: None,
                                archived: false,
                                due_at: None,
                                assignment_group_id: None,
                                created_at: now,
                                updated_at: now,
                                is_adaptive: None,
                                points_possible: None,
                                points_worth: None,
                                external_url: None,
                            });
                            content_pages.insert(
                                pid,
                                ExportedContentPageBody {
                                    markdown,
                                    due_at: None,
                                },
                            );
                            sort_order += 1;
                            continue;
                        }
                    };
                    let body_html = page_json
                        .get("body")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let markdown = html_to_markdown(body_html);
                    let pid = Uuid::new_v4();
                    structure.push(CourseStructureItemResponse {
                        id: pid,
                        sort_order,
                        kind: "content_page".into(),
                        title,
                        parent_id: Some(module_id),
                        published: item_published,
                        visible_from: None,
                        archived: false,
                        due_at: None,
                        assignment_group_id: None,
                        created_at: now,
                        updated_at: now,
                        is_adaptive: None,
                        points_possible: None,
                        points_worth: None,
                        external_url: None,
                    });
                    content_pages.insert(
                        pid,
                        ExportedContentPageBody {
                            markdown,
                            due_at: None,
                        },
                    );
                    sort_order += 1;
                }
                "Assignment" => {
                    if !include.assignments {
                        continue;
                    }
                    let Some(aid) = json_i64(item.get("content_id")) else {
                        continue;
                    };
                    canvas_export_append_assignment_details(
                        client,
                        &base,
                        token,
                        cid,
                        aid,
                        title,
                        item_published,
                        module_id,
                        &mut sort_order,
                        now,
                        map_grading_groups,
                        &canvas_ag_to_lex,
                        &mut structure,
                        &mut assignments,
                        progress,
                        &mut first_assignment_msg,
                    )
                    .await?;
                }
                "Quiz" => {
                    if !include.quizzes {
                        continue;
                    }
                    let Some(qid) = json_i64(item.get("content_id")) else {
                        continue;
                    };
                    canvas_export_append_quiz_details(
                        client,
                        &base,
                        token,
                        cid,
                        &cid_str,
                        qid,
                        title,
                        item_published,
                        module_id,
                        &mut sort_order,
                        now,
                        map_grading_groups,
                        &canvas_ag_to_lex,
                        &mut structure,
                        &mut quizzes,
                        progress,
                        &mut first_quiz_msg,
                        &mut first_quiz_questions_msg,
                    )
                    .await?;
                }
                "Discussion" => {
                    if first_discussion_msg {
                        emit_progress(progress, "Reading discussions from Canvas…");
                        first_discussion_msg = false;
                    }
                    let Some(did) = json_i64(item.get("content_id")) else {
                        continue;
                    };
                    let dj = match canvas_course_subresource_url(
                        &base,
                        cid,
                        &format!("discussion_topics/{did}"),
                    ) {
                        Ok(u) => canvas_get_json_url(client, u, token).await.ok(),
                        Err(_) => None,
                    };
                    let msg = dj
                        .as_ref()
                        .and_then(|v| v.get("message").and_then(|x| x.as_str()))
                        .unwrap_or("");
                    let mut markdown = html_to_markdown(msg);
                    if markdown.is_empty() {
                        markdown = if !html_url.is_empty() {
                            format!("**Discussion:** [{title}]({html_url})")
                        } else {
                            format!("**Discussion:** {title}")
                        };
                    } else if !html_url.is_empty() {
                        markdown.push_str(&format!("\n\n[Open in Canvas]({html_url})"));
                    }
                    let pid = Uuid::new_v4();
                    structure.push(CourseStructureItemResponse {
                        id: pid,
                        sort_order,
                        kind: "content_page".into(),
                        title,
                        parent_id: Some(module_id),
                        published: item_published,
                        visible_from: None,
                        archived: false,
                        due_at: None,
                        assignment_group_id: None,
                        created_at: now,
                        updated_at: now,
                        is_adaptive: None,
                        points_possible: None,
                        points_worth: None,
                        external_url: None,
                    });
                    content_pages.insert(
                        pid,
                        ExportedContentPageBody {
                            markdown,
                            due_at: None,
                        },
                    );
                    sort_order += 1;
                }
                // Canvas `external_url` applies to ExternalUrl and ExternalTool; File uses
                // `html_url` / download targets when `external_url` is absent.
                "ExternalUrl" | "ExternalTool" | "File" => {
                    let ext_url = item
                        .get("external_url")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .or_else(|| {
                            if matches!(type_str, "ExternalUrl" | "ExternalTool") {
                                item.get("url")
                                    .and_then(|v| v.as_str())
                                    .map(str::trim)
                                    .filter(|s| !s.is_empty())
                                    .map(String::from)
                            } else {
                                None
                            }
                        })
                        .or_else(|| (!html_url.is_empty()).then_some(html_url.clone()));

                    if let Some(raw) = ext_url.as_deref() {
                        if let Ok(normalized) =
                            course_module_external_links::validate_external_http_url(raw)
                        {
                            let lid = Uuid::new_v4();
                            structure.push(CourseStructureItemResponse {
                                id: lid,
                                sort_order,
                                kind: "external_link".into(),
                                title,
                                parent_id: Some(module_id),
                                published: item_published,
                                visible_from: None,
                                archived: false,
                                due_at: None,
                                assignment_group_id: None,
                                created_at: now,
                                updated_at: now,
                                is_adaptive: None,
                                points_possible: None,
                                points_worth: None,
                                external_url: Some(normalized),
                            });
                            sort_order += 1;
                            continue;
                        }
                    }

                    let markdown = if let Some(u) = ext_url.as_ref() {
                        format!("**{title}**\n\n[Open link]({u})")
                    } else {
                        format!("**{title}**\n\n_(Canvas {type_str}; no URL was provided.)_")
                    };
                    let pid = Uuid::new_v4();
                    structure.push(CourseStructureItemResponse {
                        id: pid,
                        sort_order,
                        kind: "content_page".into(),
                        title,
                        parent_id: Some(module_id),
                        published: item_published,
                        visible_from: None,
                        archived: false,
                        due_at: None,
                        assignment_group_id: None,
                        created_at: now,
                        updated_at: now,
                        is_adaptive: None,
                        points_possible: None,
                        points_worth: None,
                        external_url: None,
                    });
                    content_pages.insert(
                        pid,
                        ExportedContentPageBody {
                            markdown,
                            due_at: None,
                        },
                    );
                    sort_order += 1;
                }
                _ => {
                    // Context modules, tools, etc.: preserve a lightweight placeholder.
                    if title.trim().is_empty() {
                        continue;
                    }
                    let markdown = if !html_url.is_empty() {
                        format!(
                            "**{title}** (`{type_str}`)\n\n[View in Canvas]({html_url})"
                        )
                    } else {
                        format!("**{title}** (`{type_str}`)")
                    };
                    let pid = Uuid::new_v4();
                    structure.push(CourseStructureItemResponse {
                        id: pid,
                        sort_order,
                        kind: "content_page".into(),
                        title,
                        parent_id: Some(module_id),
                        published: item_published,
                        visible_from: None,
                        archived: false,
                        due_at: None,
                        assignment_group_id: None,
                        created_at: now,
                        updated_at: now,
                        is_adaptive: None,
                        points_possible: None,
                        points_worth: None,
                        external_url: None,
                    });
                    content_pages.insert(
                        pid,
                        ExportedContentPageBody {
                            markdown,
                            due_at: None,
                        },
                    );
                    sort_order += 1;
                }
            }
        }
    }

    if !include.modules && (include.assignments || include.quizzes) {
        emit_progress(
            progress,
            "Loading course-wide assignments and quizzes from Canvas…",
        );
        let synthetic_parent = Uuid::new_v4();
        structure.push(CourseStructureItemResponse {
            id: synthetic_parent,
            sort_order,
            kind: "module".into(),
            title: "Imported from Canvas".into(),
            parent_id: None,
            published: true,
            visible_from: None,
            archived: false,
            due_at: None,
            assignment_group_id: None,
            created_at: now,
            updated_at: now,
            is_adaptive: None,
            points_possible: None,
            points_worth: None,
            external_url: None,
        });
        sort_order += 1;

        if include.assignments {
            let mut arows = canvas_get_json_array_paginated(
                client,
                &base,
                token,
                &["courses", &cid_str, "assignments"],
                &[],
            )
            .await
            .unwrap_or_default();
            arows.sort_by_key(|r| {
                r.get("position")
                    .and_then(|v| v.as_i64())
                    .or_else(|| json_i64(r.get("id")))
                    .unwrap_or(9999)
            });
            for row in arows {
                let Some(aid) = json_i64(row.get("id")) else {
                    continue;
                };
                let atitle =
                    json_string(row.get("name")).unwrap_or_else(|| "Assignment".to_string());
                let item_published = row
                    .get("published")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                canvas_export_append_assignment_details(
                    client,
                    &base,
                    token,
                    cid,
                    aid,
                    atitle,
                    item_published,
                    synthetic_parent,
                    &mut sort_order,
                    now,
                    map_grading_groups,
                    &canvas_ag_to_lex,
                    &mut structure,
                    &mut assignments,
                    progress,
                    &mut first_assignment_msg,
                )
                .await?;
            }
        }
        if include.quizzes {
            let mut qrows = canvas_get_json_array_paginated(
                client,
                &base,
                token,
                &["courses", &cid_str, "quizzes"],
                &[],
            )
            .await
            .unwrap_or_default();
            qrows.sort_by_key(|r| {
                r.get("position")
                    .and_then(|v| v.as_i64())
                    .or_else(|| json_i64(r.get("id")))
                    .unwrap_or(9999)
            });
            for row in qrows {
                let Some(qid) = json_i64(row.get("id")) else {
                    continue;
                };
                let qtitle = json_string(row.get("title"))
                    .or_else(|| json_string(row.get("name")))
                    .unwrap_or_else(|| "Quiz".to_string());
                let item_published = row
                    .get("published")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                canvas_export_append_quiz_details(
                    client,
                    &base,
                    token,
                    cid,
                    &cid_str,
                    qid,
                    qtitle,
                    item_published,
                    synthetic_parent,
                    &mut sort_order,
                    now,
                    map_grading_groups,
                    &canvas_ag_to_lex,
                    &mut structure,
                    &mut quizzes,
                    progress,
                    &mut first_quiz_msg,
                    &mut first_quiz_questions_msg,
                )
                .await?;
            }
        }
    }

    let enrollments = if include.enrollments {
        emit_progress(progress, "Loading Canvas enrollments (for roles)…");
        let enrollment_rows = match canvas_get_json_array_paginated(
            client,
            &base,
            token,
            &["courses", &cid_str, "enrollments"],
            &[
                ("state[]", "active"),
                ("state[]", "invited"),
                ("state[]", "creation_pending"),
            ],
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                emit_progress(
                    progress,
                    &format!(
                        "Could not load Canvas enrollments ({}). Roster will use course users only.",
                        e
                    ),
                );
                Vec::new()
            }
        };

        emit_progress(progress, "Loading Canvas course users (for emails and names)…");
        let course_user_rows =
            match canvas_fetch_course_users_for_roster(client, &base, token, &cid_str).await {
                Ok(v) => v,
                Err(e) => {
                    emit_progress(
                        progress,
                        &format!(
                            "Could not load Canvas course users ({}). Roster will use enrollment data only.",
                            e
                        ),
                    );
                    Vec::new()
                }
            };

        let enrollments =
            canvas_build_enrollments_from_canvas_data(&enrollment_rows, &course_user_rows);
        emit_progress(
            progress,
            &format!(
                "Prepared {} roster row(s) from Canvas ({} enrollment(s), {} user profile(s)).",
                enrollments.len(),
                enrollment_rows.len(),
                course_user_rows.len()
            ),
        );
        enrollments
    } else {
        emit_progress(progress, "Skipping Canvas roster (enrollments import disabled).");
        Vec::new()
    };
    emit_progress(progress, "Building export bundle from Canvas data…");

    let snap = CourseExportSnapshot {
        title,
        description,
        hero_image_url: None,
        hero_image_object_position: None,
        starts_at,
        ends_at,
        visible_from: None,
        hidden_at: None,
        schedule_mode: "fixed".into(),
        relative_end_after: None,
        relative_hidden_after: None,
        relative_schedule_anchor_at: None,
        published,
        markdown_theme_preset: "classic".into(),
        markdown_theme_custom: None,
        notebook_enabled: true,
        feed_enabled: true,
        calendar_enabled: true,
        question_bank_enabled: false,
        lockdown_mode_enabled: false,
    };

    Ok(CourseExportV1 {
        format_version: EXPORT_FORMAT_VERSION,
        exported_at: Utc::now(),
        course_code: format!("canvas-{cid}"),
        course: snap,
        syllabus,
        require_syllabus_acceptance: false,
        grading,
        structure,
        content_pages,
        assignments,
        quizzes,
        enrollments,
    })
}

/// Parse course id string then build export (for HTTP handlers).
pub async fn build_export_from_canvas_wire(
    client: &Client,
    canvas_base_url: &str,
    canvas_course_id_raw: &str,
    access_token: &str,
    include: CanvasImportInclude,
    allowed_host_suffixes: &[String],
    progress: Option<&UnboundedSender<String>>,
) -> Result<CourseExportV1, AppError> {
    let cid = parse_canvas_course_id(canvas_course_id_raw)?;
    build_export_from_canvas(
        client,
        canvas_base_url,
        cid,
        access_token,
        include,
        allowed_host_suffixes,
        progress,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_host_suffix_policy_allows_subdomain_and_exact_match() {
        let policy = vec!["instructure.com".to_string()];
        assert!(host_allowed_by_suffix_policy(
            "school.instructure.com",
            &policy
        ));
        assert!(host_allowed_by_suffix_policy("instructure.com", &policy));
    }

    #[test]
    fn canvas_host_suffix_policy_rejects_unlisted_hosts() {
        let policy = vec!["instructure.com".to_string()];
        assert!(!host_allowed_by_suffix_policy("evil-example.com", &policy));
        assert!(!host_allowed_by_suffix_policy(
            "instructure.com.evil-example.com",
            &policy
        ));
    }
}
