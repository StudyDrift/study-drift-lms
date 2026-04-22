//! Async QTI / Common Cartridge import into the normalized question bank (plan 2.13).

use std::path::Path;

use chrono::Utc;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::repos::question_bank as qb_repo;
use crate::repos::qti_import as import_repo;
use crate::services::common_cartridge;
use crate::services::qti_parser::{self, ParsedQtiItem};
use crate::services::zip_import::extract_zip_from_bytes;

fn virus_scan_stub(_bytes: &[u8]) {
    tracing::info!(
        target: "qti_import",
        virus_scan = "skipped",
        "configure external scanning in production (plan 8.6)"
    );
}

fn manifest_paths(extract_root: &Path) -> Vec<std::path::PathBuf> {
    let mut cands = vec![extract_root.join("imsmanifest.xml")];
    if let Ok(rd) = std::fs::read_dir(extract_root) {
        for e in rd.flatten() {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                cands.push(e.path().join("imsmanifest.xml"));
            }
        }
    }
    cands.into_iter().filter(|p| p.is_file()).collect()
}

fn resolve_item_paths(import_type: &str, extract_root: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let manifests = manifest_paths(extract_root);
    if import_type == "common_cartridge" || !manifests.is_empty() {
        for m in manifests {
            let xml = std::fs::read_to_string(&m).map_err(|e| e.to_string())?;
            let mut paths = common_cartridge::qti_xml_paths_from_manifest(&xml, extract_root)?;
            if !paths.is_empty() {
                paths.retain(|p| p.is_file());
                return Ok(paths);
            }
        }
    }
    let mut paths = common_cartridge::discover_xml_files(extract_root);
    paths.retain(|p| {
        std::fs::read_to_string(p)
            .ok()
            .map(|s| qti_parser::looks_like_assessment_item(&s))
            .unwrap_or(false)
    });
    Ok(paths)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImportRowOutcome {
    Imported,
    SkippedDuplicate,
}

async fn import_one_item(
    pool: &PgPool,
    course_id: Uuid,
    job_id: Uuid,
    user_id: Uuid,
    original_filename: &str,
    parsed: ParsedQtiItem,
) -> Result<ImportRowOutcome, String> {
    let source_type = "qti21";
    let source_identifier = format!("qti:{}", parsed.identifier);
    if import_repo::find_imported_question_id(pool, course_id, source_type, &source_identifier)
        .await
        .map_err(|e| e.to_string())?
        .is_some()
    {
        import_repo::bump_job_counters(pool, job_id, 1, 0, 0, 1)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(ImportRowOutcome::SkippedDuplicate);
    }

    let mut meta = json!({
        "importJobId": job_id,
        "qtiItemIdentifier": parsed.identifier,
        "originalPackage": original_filename,
    });
    if let Some(t) = &parsed.title {
        meta["qtiItemTitle"] = json!(t);
    }
    if let Some(n) = &parsed.needs_review_note {
        meta["qtiImportNeedsReviewReason"] = json!(n);
    }

    let status = parsed.status;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let qid = qb_repo::insert_question(
        &mut tx,
        course_id,
        &parsed.question_type,
        &parsed.stem,
        parsed.options.as_ref(),
        parsed.correct_answer.as_ref(),
        None,
        parsed.points,
        status,
        false,
        "qti",
        &meta,
        Some(user_id),
        parsed.shuffle_choices_override,
        false,
    )
    .await
    .map_err(|e| e.to_string())?;

    let now = Utc::now();
    let inserted = qb_repo::QuestionEntity {
        id: qid,
        course_id,
        question_type: parsed.question_type.clone(),
        stem: parsed.stem.clone(),
        options: parsed.options.clone(),
        correct_answer: parsed.correct_answer.clone(),
        explanation: None,
        points: parsed.points,
        status: status.to_string(),
        shared: false,
        source: "qti".into(),
        metadata: meta.clone(),
        shuffle_choices_override: parsed.shuffle_choices_override,
        irt_a: None,
        irt_b: None,
        irt_c: None,
        irt_status: "uncalibrated".into(),
        irt_sample_n: 0,
        irt_calibrated_at: None,
        created_by: Some(user_id),
        created_at: now,
        updated_at: now,
        version_number: 1,
        is_published: status == "active",
        srs_eligible: false,
    };
    qb_repo::insert_question_version_snapshot(
        &mut *tx,
        &inserted,
        Some("Imported from QTI / Common Cartridge"),
        Some(&json!({ "qtiImport": true, "importJobId": job_id })),
        Some(user_id),
    )
    .await
    .map_err(|e| e.to_string())?;

    import_repo::insert_imported_source(
        &mut *tx,
        course_id,
        qid,
        source_type,
        &source_identifier,
        job_id,
    )
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    import_repo::bump_job_counters(pool, job_id, 1, 1, 0, 0)
        .await
        .map_err(|e| e.to_string())?;

    tracing::info!(target: "qti_import", questions_imported = 1, question_id = %qid);

    Ok(ImportRowOutcome::Imported)
}

/// Runs the import job end-to-end (extract → parse → persist). Updates `import_jobs` rows.
pub async fn run_import_job(
    pool: PgPool,
    job_id: Uuid,
    course_id: Uuid,
    user_id: Uuid,
    import_type: String,
    original_filename: String,
    bytes: Vec<u8>,
) {
    virus_scan_stub(&bytes);

    let root = std::env::temp_dir().join(format!(
        "lextures-qti-import-{}-{}",
        job_id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    if let Err(e) = std::fs::create_dir_all(&root) {
        let _ = import_repo::mark_job_failed(&pool, job_id, &e.to_string()).await;
        return;
    }
    if let Err(e) = extract_zip_from_bytes(&bytes, &root) {
        let msg = crate::services::zip_import::user_visible_message(&e);
        let _ = import_repo::mark_job_failed(&pool, job_id, &msg).await;
        tracing::warn!(target: "qti_import", questions_failed = 1, error = %msg);
        let _ = std::fs::remove_dir_all(&root);
        return;
    }

    let paths = match resolve_item_paths(&import_type, &root) {
        Ok(p) => p,
        Err(e) => {
            let _ = import_repo::mark_job_failed(&pool, job_id, &e).await;
            let _ = std::fs::remove_dir_all(&root);
            return;
        }
    };

    let total = paths.len().min(i32::MAX as usize) as i32;
    if let Err(e) = import_repo::mark_job_running(&pool, job_id, total).await {
        tracing::error!(error = %e, "mark_job_running failed");
        let _ = std::fs::remove_dir_all(&root);
        return;
    }

    if paths.is_empty() {
        let _ = import_repo::mark_job_done(&pool, job_id).await;
        let _ = std::fs::remove_dir_all(&root);
        return;
    }

    let mut imported = 0i64;
    let mut failed = 0i64;

    for p in paths {
        let xml = match std::fs::read_to_string(&p) {
            Ok(s) => s,
            Err(e) => {
                failed += 1;
                let entry = json!({ "item_id": p.display().to_string(), "reason": e.to_string() });
                let _ = import_repo::append_job_error(&pool, job_id, &entry).await;
                let _ = import_repo::bump_job_counters(&pool, job_id, 1, 0, 1, 0).await;
                continue;
            }
        };
        if !qti_parser::looks_like_assessment_item(&xml) {
            let _ = import_repo::bump_job_counters(&pool, job_id, 1, 0, 0, 1).await;
            continue;
        }
        let parsed = match qti_parser::parse_assessment_item_xml(&xml) {
            Ok(v) => v,
            Err(e) => {
                failed += 1;
                let entry = json!({ "item_id": p.display().to_string(), "reason": e });
                let _ = import_repo::append_job_error(&pool, job_id, &entry).await;
                let _ = import_repo::bump_job_counters(&pool, job_id, 1, 0, 1, 0).await;
                continue;
            }
        };
        let item_label = parsed.identifier.clone();
        match import_one_item(&pool, course_id, job_id, user_id, &original_filename, parsed).await {
            Ok(ImportRowOutcome::Imported) => {
                imported += 1;
            }
            Ok(ImportRowOutcome::SkippedDuplicate) => {}
            Err(e) => {
                failed += 1;
                let entry = json!({ "item_id": item_label, "reason": e });
                let _ = import_repo::append_job_error(&pool, job_id, &entry).await;
                let _ = import_repo::bump_job_counters(&pool, job_id, 1, 0, 1, 0).await;
            }
        }
    }

    tracing::info!(
        target: "qti_import",
        job_id = %job_id,
        questions_imported = imported,
        questions_failed = failed,
        "import_job_complete"
    );

    let _ = import_repo::mark_job_done(&pool, job_id).await;
    let _ = std::fs::remove_dir_all(&root);
}
