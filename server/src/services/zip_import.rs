//! Safe ZIP extraction for QTI / Common Cartridge imports (plan 2.13).

use std::fs;
use std::path::{Component, Path, PathBuf};

use zip::read::ZipArchive;

const MAX_EXTRACTED_BYTES: u64 = 500 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 100;

#[derive(Debug, Clone)]
pub enum ZipImportError {
    PathTraversal(String),
    ZipBombCompression { name: String, ratio: u64 },
    ZipBombTotalSize { extracted: u64 },
    Io(String),
    Zip(String),
}

impl std::fmt::Display for ZipImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ZipImportError::PathTraversal(p) => write!(f, "ZIP entry path is unsafe: {p}"),
            ZipImportError::ZipBombCompression { name, ratio } => write!(
                f,
                "ZIP entry '{name}' has excessive compression ratio ({ratio}:1)."
            ),
            ZipImportError::ZipBombTotalSize { extracted } => {
                write!(
                    f,
                    "ZIP would extract to {extracted} bytes (limit {MAX_EXTRACTED_BYTES})."
                )
            }
            ZipImportError::Io(s) => write!(f, "{s}"),
            ZipImportError::Zip(s) => write!(f, "{s}"),
        }
    }
}

impl std::error::Error for ZipImportError {}

/// User-facing message for HTTP 422 responses (plan 2.13 AC-3).
pub fn user_visible_message(e: &ZipImportError) -> String {
    match e {
        ZipImportError::ZipBombTotalSize { .. } => "File too large when extracted.".into(),
        ZipImportError::ZipBombCompression { .. } => "ZIP compression ratio is not allowed.".into(),
        ZipImportError::PathTraversal(p) => format!("ZIP contains unsafe paths: {p}"),
        ZipImportError::Io(s) | ZipImportError::Zip(s) => s.clone(),
    }
}

fn safe_join(base: &Path, rel: &Path) -> Result<PathBuf, ZipImportError> {
    let mut out = base.to_path_buf();
    for c in rel.components() {
        match c {
            Component::Normal(p) => out.push(p),
            Component::ParentDir => {
                return Err(ZipImportError::PathTraversal(rel.display().to_string()));
            }
            Component::RootDir | Component::Prefix(_) | Component::CurDir => {}
        }
    }
    if !out.starts_with(base) {
        return Err(ZipImportError::PathTraversal(rel.display().to_string()));
    }
    Ok(out)
}

/// Validates archive entries without extracting (compression ratio + total uncompressed size).
pub fn validate_zip_limits(bytes: &[u8]) -> Result<(), ZipImportError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| ZipImportError::Zip(e.to_string()))?;
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| ZipImportError::Zip(e.to_string()))?;
        let name = file.name().to_string();
        if name.contains("..") {
            return Err(ZipImportError::PathTraversal(name));
        }
        let uncompressed = file.size();
        if uncompressed == 0 {
            continue;
        }
        let compressed = file.compressed_size().max(1);
        total = total.saturating_add(uncompressed);
        if total > MAX_EXTRACTED_BYTES {
            return Err(ZipImportError::ZipBombTotalSize { extracted: total });
        }
        if uncompressed > compressed.saturating_mul(MAX_COMPRESSION_RATIO) {
            let ratio = (uncompressed / compressed).max(1);
            return Err(ZipImportError::ZipBombCompression { name, ratio });
        }
    }
    Ok(())
}

/// Extracts a ZIP into `dest_dir` after validation. Creates directories as needed.
pub fn extract_zip_from_bytes(bytes: &[u8], dest_dir: &Path) -> Result<(), ZipImportError> {
    validate_zip_limits(bytes)?;
    let cursor = std::io::Cursor::new(bytes.to_vec());
    let mut archive = ZipArchive::new(cursor).map_err(|e| ZipImportError::Zip(e.to_string()))?;
    fs::create_dir_all(dest_dir).map_err(|e| ZipImportError::Io(e.to_string()))?;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| ZipImportError::Zip(e.to_string()))?;
        let rel = Path::new(file.name());
        let out_path = safe_join(dest_dir, rel)?;
        if file.name().ends_with('/') || file.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| ZipImportError::Io(e.to_string()))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| ZipImportError::Io(e.to_string()))?;
        }
        let mut out = fs::File::create(&out_path).map_err(|e| ZipImportError::Io(e.to_string()))?;
        std::io::copy(&mut file, &mut out).map_err(|e| ZipImportError::Io(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::{SimpleFileOptions, ZipWriter};

    #[test]
    fn rejects_parent_dir() {
        let cursor = std::io::Cursor::new(Vec::<u8>::new());
        let mut zip = ZipWriter::new(cursor);
        zip.start_file("../evil.txt", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"x").unwrap();
        let cursor = zip.finish().unwrap();
        let bytes = cursor.into_inner();
        let dest = std::env::temp_dir().join(format!(
            "lextures-zip-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::create_dir_all(&dest);
        let err = extract_zip_from_bytes(&bytes, &dest).unwrap_err();
        assert!(matches!(err, ZipImportError::PathTraversal(_)));
        let _ = fs::remove_dir_all(&dest);
    }
}
