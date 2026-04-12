use std::path::{Path, PathBuf};

use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CourseFileRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub storage_key: String,
    pub original_filename: String,
    pub mime_type: String,
    pub byte_size: i64,
}

pub async fn insert(
    pool: &PgPool,
    id: Uuid,
    course_id: Uuid,
    storage_key: &str,
    original_filename: &str,
    mime_type: &str,
    byte_size: i64,
    uploaded_by: Uuid,
) -> Result<CourseFileRow, sqlx::Error> {
    sqlx::query_as::<_, CourseFileRow>(
        r#"
        INSERT INTO course.course_files (id, course_id, storage_key, original_filename, mime_type, byte_size, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, course_id, storage_key, original_filename, mime_type, byte_size
        "#,
    )
    .bind(id)
    .bind(course_id)
    .bind(storage_key)
    .bind(original_filename)
    .bind(mime_type)
    .bind(byte_size)
    .bind(uploaded_by)
    .fetch_one(pool)
    .await
}

pub async fn get_for_course(
    pool: &PgPool,
    course_code: &str,
    file_id: Uuid,
) -> Result<Option<CourseFileRow>, sqlx::Error> {
    sqlx::query_as::<_, CourseFileRow>(
        r#"
        SELECT f.id, f.course_id, f.storage_key, f.original_filename, f.mime_type, f.byte_size
        FROM course.course_files f
        INNER JOIN course.courses c ON c.id = f.course_id AND c.course_code = $2
        WHERE f.id = $1
        "#,
    )
    .bind(file_id)
    .bind(course_code)
    .fetch_optional(pool)
    .await
}

/// Matches on-disk layout under `course_files_root` used by course file upload routes.
fn disk_course_dir_segment(course_code: &str) -> String {
    let t = course_code.trim();
    if t.is_empty() {
        return "_unknown".into();
    }
    t.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .take(200)
        .collect()
}

pub fn blob_disk_path(root: &Path, course_code: &str, storage_key: &str) -> PathBuf {
    root.join(disk_course_dir_segment(course_code)).join(storage_key)
}

pub async fn remove_stored_blobs(root: &Path, course_code: &str, storage_keys: &[String]) {
    for key in storage_keys {
        let path = blob_disk_path(root, course_code, key);
        let _ = tokio::fs::remove_file(path).await;
    }
}
