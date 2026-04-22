//! On-disk storage for assignment submission A/V feedback under `COURSE_FILES_ROOT/feedback/<course_code>/`.
//! Plan 3.2 — not yet wired to S3; local layout matches the object key scheme for future migration.

use std::path::{Path, PathBuf};

use crate::error::AppError;

/// 500 MB (plan 3.2 NFR)
pub const MAX_FEEDBACK_MEDIA_BYTES: u64 = 500 * 1024 * 1024;
/// 10 minutes (FR-4)
pub const MAX_RECORDING_SECS: i32 = 600;

fn truncate_filename(name: &str) -> String {
    let t = name.trim();
    if t.is_empty() {
        return "upload".into();
    }
    t.chars().take(240).collect()
}

/// Allowed MIME types for upload / recording.
pub fn normalize_feedback_mime(raw: Option<&str>) -> Option<&'static str> {
    let t = raw?.split(';').next()?.trim().to_ascii_lowercase();
    match t.as_str() {
        "audio/mpeg" | "audio/mp3" => Some("audio/mpeg"),
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => Some("audio/mp4"),
        "audio/webm" => Some("audio/webm"),
        "video/mp4" => Some("video/mp4"),
        "video/quicktime" => Some("video/quicktime"),
        "video/webm" => Some("video/webm"),
        _ => None,
    }
}

pub fn ext_for_mime(mime: &str) -> &'static str {
    match mime {
        "audio/mpeg" => "mp3",
        "audio/mp4" | "audio/m4a" => "m4a",
        "audio/webm" => "webm",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        _ => "bin",
    }
}

pub fn media_type_for_mime(mime: &str) -> Option<&'static str> {
    if mime.starts_with("audio/") {
        return Some("audio");
    }
    if mime.starts_with("video/") {
        return Some("video");
    }
    None
}

pub fn feedback_dir(course_files_root: &Path, course_code: &str) -> PathBuf {
    course_files_root.join("feedback").join(course_code)
}

pub fn feedback_blob_path(
    course_files_root: &Path,
    course_code: &str,
    storage_key: &str,
) -> PathBuf {
    feedback_dir(course_files_root, course_code).join(storage_key)
}

/// Plain-text transcription → minimal WebVTT (single cue) for `<track kind="captions">`.
pub fn text_to_webvtt(text: &str, duration_secs: f32) -> String {
    let dur = duration_secs.max(1.0);
    let end = format_duration_vtt(dur);
    let body = text
        .trim()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    format!("WEBVTT\n\n00:00:00.000 --> {end}\n{body}\n")
}

fn format_duration_vtt(secs: f32) -> String {
    let s = secs.floor() as u32;
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let sec = s % 60;
    let frac = (secs - secs.floor()).max(0.0);
    let ms = (frac * 1000.0).round() as u32;
    format!("{h:02}:{m:02}:{sec:02}.{ms:03}")
}

/// Validates multipart filename + declared MIME for feedback uploads.
pub fn parse_upload_file_meta(filename: &str, declared_mime: Option<&str>) -> Result<String, AppError> {
    let _ = truncate_filename(filename);
    let Some(m) = normalize_feedback_mime(declared_mime) else {
        return Err(AppError::invalid_input(
            "File type not allowed. Use MP3, M4A, MP4, MOV, or WEBM.",
        ));
    };
    Ok(m.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webvtt_single_cue() {
        let v = text_to_webvtt("Hi & you", 12.0);
        assert!(v.starts_with("WEBVTT"));
        assert!(v.contains("&amp;"));
    }
}
