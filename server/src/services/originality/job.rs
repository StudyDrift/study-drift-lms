use std::path::PathBuf;

use rust_decimal::Decimal;
use tracing::{info, warn};
use uuid::Uuid;

use crate::repos::course_files;
use crate::repos::course_module_assignments;
use crate::repos::module_assignment_submissions;
use crate::repos::originality_platform_config;
use crate::repos::originality_reports;
use crate::services::ai::OpenRouterClient;
use crate::services::originality::internal;
use crate::services::originality::text_extract;
use crate::state::AppState;

const INTERNAL_MODEL_DEFAULT: &str = "openai/gpt-4o-mini";

/// Runs after a successful submission upsert when originality is enabled for the assignment.
pub fn spawn_originality_detection_job(state: AppState, course_code: String, submission_id: Uuid) {
    if !state.originality_detection_enabled {
        return;
    }
    let pool = state.pool.clone();
    let root = state.course_files_root.clone();
    let open_router = state.open_router.clone();
    let stub_external = state.originality_stub_external;
    let public_origin = state.public_web_origin.clone();
    tokio::spawn(async move {
        if let Err(e) = run_detection_job(
            &pool,
            &root,
            open_router.as_deref(),
            stub_external,
            &public_origin,
            &course_code,
            submission_id,
        )
        .await
        {
            warn!(%submission_id, error = %e, "originality detection job failed");
        }
    });
}

async fn run_detection_job(
    pool: &sqlx::PgPool,
    course_files_root: &std::path::Path,
    open_router: Option<&OpenRouterClient>,
    stub_external: bool,
    public_web_origin: &str,
    course_code: &str,
    submission_id: Uuid,
) -> anyhow::Result<()> {
    let Some(sub) = module_assignment_submissions::get_by_id(pool, submission_id).await? else {
        return Ok(());
    };

    let Some(asn) =
        course_module_assignments::get_for_course_item(pool, sub.course_id, sub.module_item_id).await?
    else {
        return Ok(());
    };

    if asn.originality_detection == "disabled" {
        return Ok(());
    }

    let platform = originality_platform_config::get_singleton(pool).await?;

    let needs_internal = matches!(asn.originality_detection.as_str(), "ai" | "both");
    let needs_external = matches!(asn.originality_detection.as_str(), "plagiarism" | "both");

    if needs_internal {
        originality_reports::insert_pending_if_missing(pool, submission_id, "internal").await?;
        originality_reports::mark_processing(pool, submission_id, "internal").await?;
        info!(target: "detection.job_enqueued", %submission_id, provider = "internal", "originality_internal_started");
        match run_internal_provider(
            pool,
            course_files_root,
            course_code,
            open_router,
            &sub,
        )
        .await
        {
            Ok(ai_pct) => {
                originality_reports::mark_done(
                    pool,
                    submission_id,
                    "internal",
                    None,
                    Some(ai_pct),
                    None,
                    None,
                    None,
                )
                .await?;
                info!(target: "detection.job_completed", %submission_id, provider = "internal", "originality_internal_done");
            }
            Err(e) => {
                originality_reports::mark_failed(pool, submission_id, "internal", &e).await?;
                warn!(target: "detection.provider_error", %submission_id, provider = "internal", error = %e);
            }
        }
    }

    if needs_external {
        let ext = platform.active_external_provider.as_str();
        if ext == "none" {
            return Ok(());
        }
        originality_reports::insert_pending_if_missing(pool, submission_id, ext).await?;
        originality_reports::mark_processing(pool, submission_id, ext).await?;
        info!(target: "detection.job_enqueued", %submission_id, provider = ext, "originality_external_started");

        if stub_external {
            let sim = Decimal::new(33, 0);
            let report_url = format!(
                "{}/about-originality-placeholder",
                public_web_origin.trim_end_matches('/')
            );
            originality_reports::mark_done(
                pool,
                submission_id,
                ext,
                Some(sim),
                None,
                Some(report_url.as_str()),
                None,
                Some("stub-scan"),
            )
            .await?;
            info!(target: "detection.job_completed", %submission_id, provider = ext, "originality_external_stub_done");
        } else {
            let rid = Uuid::new_v4().to_string();
            originality_reports::set_provider_report_id(pool, submission_id, ext, &rid).await?;
            sqlx::query(&format!(
                "UPDATE {} SET status = 'pending', updated_at = NOW() WHERE submission_id = $1 AND provider = $2",
                crate::db::schema::ORIGINALITY_REPORTS
            ))
            .bind(submission_id)
            .bind(ext)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

async fn run_internal_provider(
    pool: &sqlx::PgPool,
    course_files_root: &std::path::Path,
    course_code: &str,
    open_router: Option<&OpenRouterClient>,
    sub: &module_assignment_submissions::SubmissionRow,
) -> Result<Decimal, String> {
    let Some(client) = open_router else {
        return Err("OpenRouter is not configured; internal AI originality is unavailable.".into());
    };
    let Some(fid) = sub.attachment_file_id else {
        return Err("No attachment; internal originality requires extractable document text.".into());
    };
    let Some(file_row) = course_files::get_for_course(pool, course_code, fid).await.map_err(|e| e.to_string())?
    else {
        return Err("Submission file not found.".into());
    };
    let path: PathBuf = course_files::blob_disk_path(course_files_root, course_code, &file_row.storage_key);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("read submission file: {e}"))?;
    let text = text_extract::submission_bytes_to_plaintext(&file_row.mime_type, &bytes)?;
    let model = std::env::var("ORIGINALITY_INTERNAL_MODEL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| INTERNAL_MODEL_DEFAULT.to_string());
    internal::classify_ai_probability(client, model.trim(), &text)
        .await
        .map_err(|e| e.to_string())
}
