//! Async caption generation (Whisper via OpenRouter) for submission feedback media (plan 3.2 FR-7).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use tokio::time::sleep;
use tracing::warn;
use uuid::Uuid;

use crate::repos::feedback_media;
use crate::services::ai::OpenRouterClient;
use crate::services::feedback_media::{feedback_blob_path, text_to_webvtt};

const MAX_ATTEMPTS: u32 = 3;

pub fn spawn_caption_job(
    pool: PgPool,
    open_router: Option<Arc<OpenRouterClient>>,
    course_files_root: PathBuf,
    course_code: String,
    media_id: Uuid,
) {
    tokio::spawn(async move {
        if let Err(e) = run_caption_job(&pool, open_router.as_deref(), &course_files_root, &course_code, media_id).await
        {
            warn!(%media_id, error = %e, "feedback media caption job failed");
        }
    });
}

async fn run_caption_job(
    pool: &PgPool,
    open_router: Option<&OpenRouterClient>,
    course_files_root: &std::path::Path,
    course_code: &str,
    media_id: Uuid,
) -> Result<(), String> {
    let Some(row) = feedback_media::get_by_id(pool, media_id)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    if row.deleted_at.is_some() || !row.upload_complete {
        return Ok(());
    }

    let _ = feedback_media::set_caption_status(pool, media_id, "processing")
        .await
        .map_err(|e| e.to_string())?;

    let Some(client) = open_router else {
        let _ = feedback_media::set_caption_status(pool, media_id, "failed").await;
        return Ok(());
    };

    let media_path = feedback_blob_path(course_files_root, course_code, &row.storage_key);
    let bytes = tokio::fs::read(&media_path)
        .await
        .map_err(|e| format!("read media for caption: {e}"))?;

    let filename = std::path::Path::new(&row.storage_key)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("media.bin");

    let mut last_err = String::new();
    let text = {
        let mut out: Option<String> = None;
        for attempt in 0..MAX_ATTEMPTS {
            match client.transcribe_audio(&bytes, filename).await {
                Ok(t) if !t.trim().is_empty() => {
                    out = Some(t);
                    break;
                }
                Ok(_) => last_err = "empty transcription".into(),
                Err(e) => last_err = e.to_string(),
            }
            sleep(Duration::from_secs(1 + u64::from(attempt))).await;
        }
        match out {
            Some(t) => t,
            None => {
                let _ = feedback_media::set_caption_status(pool, media_id, "failed")
                    .await
                    .map_err(|e| e.to_string())?;
                return Err(last_err);
            }
        }
    };

    let parent = std::path::Path::new(&row.storage_key)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let caption_key = format!(
        "{}/captions.vtt",
        parent.to_string_lossy()
    );
    let caption_path = feedback_blob_path(course_files_root, course_code, &caption_key);
    if let Some(parent) = caption_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let dur = row.duration_secs.map(|s| s as f32).unwrap_or(120.0);
    let vtt = text_to_webvtt(&text, dur);
    tokio::fs::write(&caption_path, vtt.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    feedback_media::set_caption_done(pool, media_id, &caption_key)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
