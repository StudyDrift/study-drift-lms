//! Object-store persistence for originality detection artifacts (plan 3.14).
//! Uses the same on-disk course file layout as submission uploads (`course_files` blob path).

use std::path::{Path, PathBuf};

use rust_decimal::Decimal;
use sqlx::PgPool;
use tracing::warn;
use uuid::Uuid;

use crate::repos::course;
use crate::repos::course_files;
use crate::repos::module_assignment_submissions::SubmissionRow;
use crate::repos::originality_reports;
use crate::services::originality::text_extract;
use serde_json::json;

const PREFIX: &str = "originality-reports";

fn key_report(report_id: Uuid) -> String {
    format!("{}/{}/report.json", PREFIX, report_id)
}

fn key_snapshot(report_id: Uuid) -> String {
    format!("{}/{}/snapshot.txt", PREFIX, report_id)
}

/// Writes provider JSON and plain-text snapshot; updates `originality_reports` with relative keys.
pub async fn try_store_detection_artifacts(
    pool: &PgPool,
    root: &Path,
    course_id: Uuid,
    report_id: Uuid,
    submission_id: Uuid,
    provider: &str,
    mut provider_json: serde_json::Value,
) -> Result<(), String> {
    if let Some(obj) = provider_json.as_object_mut() {
        obj
            .entry("capturedAt")
            .or_insert_with(|| json!(chrono::Utc::now().to_rfc3339()));
        obj.insert("submissionId".to_string(), json!(submission_id.to_string()));
        obj.insert("reportId".to_string(), json!(report_id.to_string()));
        obj.insert("provider".to_string(), json!(provider));
    }

    let course_row = course::get_by_id(pool, course_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "course not found for submission".to_string())?;
    let course_code = course_row.course_code;

    let r_key = key_report(report_id);
    let s_key = key_snapshot(report_id);
    let path_r = course_files::blob_disk_path(root, &course_code, &r_key);
    let path_s = course_files::blob_disk_path(root, &course_code, &s_key);
    for p in [path_r.parent(), path_s.parent()] {
        if let Some(d) = p {
            tokio::fs::create_dir_all(d)
                .await
                .map_err(|e| format!("create storage dir: {e}"))?;
        }
    }

    let text = text_from_provider_json(&provider_json);
    let report_bytes = serde_json::to_vec_pretty(&provider_json).map_err(|e| e.to_string())?;
    tokio::fs::write(&path_r, &report_bytes)
        .await
        .map_err(|e| format!("write report json: {e}"))?;
    tokio::fs::write(&path_s, text.as_bytes())
        .await
        .map_err(|e| format!("write snapshot: {e}"))?;

    originality_reports::set_storage_keys(pool, report_id, &r_key, &s_key)
        .await
        .map_err(|e| e.to_string())?;

    tracing::info!(
        target: "originality_report.stored",
        %submission_id,
        %report_id,
        %provider,
        storage_key = %r_key,
        "originality report JSON and snapshot written"
    );

    Ok(())
}

/// Attempt storage after a failure (does not clobber `mark_done` row state).
pub async fn best_effort_store_from_parts(
    pool: &PgPool,
    root: &Path,
    course_id: Uuid,
    report_id: Uuid,
    submission_id: Uuid,
    provider: &str,
    full_json: serde_json::Value,
) {
    if let Err(e) =
        try_store_detection_artifacts(pool, root, course_id, report_id, submission_id, provider, full_json).await
    {
        warn!(
            target: "originality_report.storage_error",
            %submission_id,
            %report_id,
            %provider,
            error = %e,
            "object storage write failed; DB detection row kept"
        );
    }
}

/// Removes on-disk report + snapshot for a row (e.g. before application-level submission delete). DB rows are separate.
pub async fn remove_artifacts_by_keys(
    root: &Path,
    course_code: &str,
    report_storage_key: Option<&str>,
    snapshot_storage_key: Option<&str>,
) {
    let mut keys: Vec<String> = Vec::new();
    if let Some(k) = report_storage_key.filter(|k| !k.is_empty()) {
        keys.push(k.to_string());
    }
    if let Some(k) = snapshot_storage_key.filter(|k| !k.is_empty()) {
        if !keys.iter().any(|e| e == k) {
            keys.push(k.to_string());
        }
    }
    course_files::remove_stored_blobs(root, course_code, &keys).await;
}

/// Removes all originality blobs for a submission (in-process cleanup helper).
pub async fn remove_all_for_submission(
    pool: &PgPool,
    root: &Path,
    course_id: Uuid,
    submission_id: Uuid,
) -> Result<(), sqlx::Error> {
    let course_row = match course::get_by_id(pool, course_id).await? {
        Some(c) => c,
        None => return Ok(()),
    };
    let rows = originality_reports::list_storage_key_pairs_for_submission(pool, submission_id).await?;
    for (a, b) in rows {
        remove_artifacts_by_keys(
            root,
            &course_row.course_code,
            a.as_deref(),
            b.as_deref(),
        )
        .await;
    }
    Ok(())
}

fn text_from_provider_json(v: &serde_json::Value) -> String {
    v.get("textSnapshot")
        .and_then(|t| t.as_str())
        .map(str::to_owned)
        .or_else(|| {
            v.get("snapshotExcerpt")
                .and_then(|t| t.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_default()
}

const SNAPSHOT_MAX_CHARS: usize = 100_000;

pub fn cap_submission_text_for_storage(s: &str) -> String {
    if s.chars().count() <= SNAPSHOT_MAX_CHARS {
        return s.to_string();
    }
    s.chars().take(SNAPSHOT_MAX_CHARS).collect()
}

/// Read submission attachment and return plain text (uncapped) for detection / webhooks.
pub async fn read_submission_file_plain(
    pool: &PgPool,
    root: &Path,
    course_code: &str,
    sub: &SubmissionRow,
) -> Result<String, String> {
    let Some(fid) = sub.attachment_file_id else {
        return Err("No attachment; cannot read text for originality snapshot.".into());
    };
    let Some(file_row) = course_files::get_for_course(pool, course_code, fid)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Err("Submission file not found.".into());
    };
    let path: PathBuf = course_files::blob_disk_path(root, course_code, &file_row.storage_key);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("read submission file: {e}"))?;
    text_extract::submission_bytes_to_plaintext(&file_row.mime_type, &bytes)
}

pub fn build_internal_json(
    ai_probability: &Decimal,
    model: &str,
    text_snapshot: &str,
) -> serde_json::Value {
    json!({
        "version": 1i32,
        "kind": "ai_probability",
        "model": model,
        "aiProbability": ai_probability,
        "similarityPct": serde_json::Value::Null,
        "textSnapshot": text_snapshot
    })
}

pub fn build_external_stub_json(
    report_url: &str,
    provider: &str,
    provider_report_id: &str,
    similarity: Decimal,
    text_snapshot: &str,
) -> serde_json::Value {
    json!({
        "version": 1i32,
        "kind": "external_plagiarism_stub",
        "stub": true,
        "reportUrl": report_url,
        "provider": provider,
        "providerReportId": provider_report_id,
        "similarityPct": similarity,
        "textSnapshot": text_snapshot
    })
}

/// Summary fields read back from a stored `report.json` (optional: augments the DB).
pub async fn read_stored_json_summary(
    root: &Path,
    course_code: &str,
    report_storage_key: &str,
) -> Result<serde_json::Value, String> {
    let path = course_files::blob_disk_path(root, course_code, report_storage_key);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("read stored report: {e}"))?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("parse report json: {e}"))?;
    Ok(v)
}
