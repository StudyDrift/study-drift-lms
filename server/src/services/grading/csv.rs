//! Gradebook bulk CSV import/export (plan 3.11).
//!
//! - Export includes UTF-8 BOM, formula-injection safe cells, and a second metadata row with
//!   module item (assignment) UUIDs for round-trips.
//! - Import validates, previews diffs, then applies in a follow-up request with audit `reason = bulk_import`.

use std::collections::{HashMap, HashSet};
use std::io::Write;

use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

use crate::models::course_grading::AssignmentGroupPublic;
use crate::models::course_gradebook::CourseGradebookGridColumn;
use crate::models::course_gradebook::GradebookImportCellPreview;
use crate::models::course_gradebook::GradebookImportPreviewRow;
use crate::models::course_gradebook::GradebookImportStats;
use crate::repos::course_grades::GradebookUpsertOp;
use crate::services::grading::assignment_groups::{compute_course_final_percent, GradebookColumnForFinal};
use crate::services::grading::conversion::{
    parse_gradebook_cell, resolve_effective, to_display_grade, DisplayGradingKind, ParsedScale,
};
use crate::services::grading::excusal::parse_csv_excuse_cell;

const META_MARK: &str = "__lextures__";
const META_V1: &str = "1";
const H_STUDENT_ID: &str = "student_id";
const H_STUDENT_NAME: &str = "student_name";
const H_STUDENT_EMAIL: &str = "student_email";
const H_SCORE_SUFFIX: &str = " (score)";
const H_DISPLAY_SUFFIX: &str = " (display grade)";
const H_EXCUSE_SUFFIX: &str = " (excuse)";
const H_FINAL_SCORE: &str = "final_score";
const H_FINAL_GRADE: &str = "final_grade";
const FINAL_NO_IMPORT: &str = "__no_import__";

const UTF8_BOM: &[u8] = &[0xef, 0xbb, 0xbf];

/// Pending import (stored server-side by token) until confirm or timeout.
pub struct GradebookImportPending {
    pub expires_at: DateTime<Utc>,
    pub user_id: Uuid,
    pub course_id: Uuid,
    /// Grade ops ready for `course_grades::upsert_and_delete` (rubric: None).
    pub ops: Vec<GradebookUpsertOp>,
    /// Plan 3.3 + 3.8: confirm with `acknowledge_blind_manual_hold`.
    pub require_blind_ack: bool,
}

#[derive(Debug, Error)]
pub enum CsvError {
    #[error("{0}")]
    Msg(String),
}

impl CsvError {
    fn m(s: impl Into<String>) -> Self {
        CsvError::Msg(s.into())
    }
}

/// Prefix a cell for CSV export to mitigate formula injection (OWASP).
pub fn sanitize_for_export(s: &str) -> String {
    let t = s.replace('\n', " ").replace('\r', " ");
    let t = t.trim();
    if t.is_empty() {
        return String::new();
    }
    let ch = t.chars().next().unwrap();
    if matches!(ch, '=' | '+' | '-' | '@' | '\t') {
        format!("'{t}")
    } else {
        t.to_string()
    }
}

fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

fn col_title_with_suffix(title: &str, suffix: &str) -> String {
    format!("{}{}", title.trim(), suffix)
}

/// Build a gradebook CSV (header row + metadata row + one row per student; 3.12 adds an ` (excuse)` column per item).
pub fn build_gradebook_export(
    students: &[(Uuid, String, String)], // id, name, email
    columns: &[CourseGradebookGridColumn],
    grades: &HashMap<Uuid, HashMap<Uuid, String>>,
    excused: &HashMap<Uuid, HashMap<Uuid, bool>>,
    assignment_groups: &[AssignmentGroupPublic],
    course_kind: Option<DisplayGradingKind>,
    parsed_scale: Option<&ParsedScale>,
    types_map: &HashMap<Uuid, Option<String>>,
) -> Result<Vec<u8>, CsvError> {
    let col_pairs: Vec<(Uuid, String, Option<i32>)> = columns
        .iter()
        .filter(|c| c.kind == "assignment" || c.kind == "quiz")
        .map(|c| (c.id, c.title.clone(), c.max_points))
        .collect();

    let for_final: Vec<GradebookColumnForFinal> = columns
        .iter()
        .filter(|c| c.kind == "assignment" || c.kind == "quiz")
        .filter_map(|c| {
            let m = c.max_points? as f64;
            if m <= 0.0 {
                return None;
            }
            Some(GradebookColumnForFinal {
                item_id: c.id,
                max_points: m,
                assignment_group_id: c.assignment_group_id,
                never_drop: c.never_drop,
                replace_with_final: c.replace_with_final,
            })
        })
        .collect();

    let mut w = Vec::new();
    w.write_all(UTF8_BOM).map_err(|e| CsvError::m(e.to_string()))?;
    {
        let mut wr = csv::Writer::from_writer(&mut w);

        let mut header: Vec<String> = vec![
            H_STUDENT_ID.into(),
            H_STUDENT_NAME.into(),
            H_STUDENT_EMAIL.into(),
        ];
        for (_, title, _) in &col_pairs {
            header.push(col_title_with_suffix(title, H_SCORE_SUFFIX));
            header.push(col_title_with_suffix(title, H_DISPLAY_SUFFIX));
            header.push(col_title_with_suffix(title, H_EXCUSE_SUFFIX));
        }
        header.push(H_FINAL_SCORE.into());
        header.push(H_FINAL_GRADE.into());
        wr.write_record(&header)
            .map_err(|e| CsvError::m(e.to_string()))?;

        let mut meta: Vec<String> = vec![META_MARK.into(), META_V1.into(), "meta".into()];
        for (id, _, _) in &col_pairs {
            meta.push(id.to_string());
            meta.push(String::new());
            meta.push(String::new());
        }
        meta.push(FINAL_NO_IMPORT.into());
        meta.push(FINAL_NO_IMPORT.into());
        wr.write_record(&meta)
            .map_err(|e| CsvError::m(e.to_string()))?;

        for (sid, name, email) in students {
            let mut rec: Vec<String> = vec![
                sanitize_for_export(&sid.to_string()),
                sanitize_for_export(name),
                sanitize_for_export(email),
            ];
            let row = grades.get(sid);
            let ex_row = excused.get(sid);
            let mut ex_map: HashMap<Uuid, bool> = HashMap::new();
            let mut earned: HashMap<Uuid, f64> = HashMap::new();
            for (id, _, maxp) in &col_pairs {
                let is_ex = ex_row
                    .and_then(|m| m.get(id))
                    .copied()
                    .unwrap_or(false);
                ex_map.insert(*id, is_ex);
                let s = row.and_then(|m| m.get(id)).map(|s| s.as_str()).unwrap_or("");
                let pts = parse_earned_points(s);
                if pts.is_finite() && !is_ex {
                    earned.insert(*id, pts);
                }
                let s_clean = s
                    .trim()
                    .replace('\n', " ")
                    .replace('\r', " ");
                rec.push(sanitize_for_export(&s_clean));
                let c = columns.iter().find(|x| x.id == *id).ok_or_else(|| {
                    CsvError::m("Inconsistent course columns during CSV export build.")
                })?;
                let ov = if c.kind == "assignment" {
                    types_map.get(id).cloned().flatten()
                } else {
                    None
                };
                let eff = resolve_effective(course_kind, ov.as_deref());
                let display = if is_ex {
                    "EX".to_string()
                } else {
                    to_display_grade(
                        pts,
                        maxp.map(|m| m as f64),
                        parsed_scale,
                        eff,
                    )
                };
                rec.push(sanitize_for_export(&display));
                let ex_cell = if is_ex { "EX" } else { "" };
                rec.push(sanitize_for_export(ex_cell));
            }

            let final_pct = compute_course_final_percent(&for_final, &earned, &ex_map, assignment_groups);
            let (fs, fg) = final_strings(final_pct, course_kind, parsed_scale);
            rec.push(sanitize_for_export(&fs));
            rec.push(sanitize_for_export(&fg));
            wr.write_record(&rec)
                .map_err(|e| CsvError::m(e.to_string()))?;
        }
        wr.flush().map_err(|e| CsvError::m(e.to_string()))?;
    }
    Ok(w)
}

fn final_strings(
    final_pct: Option<f64>,
    course_kind: Option<DisplayGradingKind>,
    parsed: Option<&ParsedScale>,
) -> (String, String) {
    let Some(p) = final_pct
        .filter(|v| v.is_finite())
    else {
        return (String::new(), String::new());
    };
    let k = course_kind.unwrap_or(DisplayGradingKind::Points);
    let fs = format!("{:.2}", (p * 10.0).round() / 10.0);
    let fg = to_display_grade(p, Some(100.0), parsed, k);
    (fs, fg)
}

/// Parse a raw grade cell from our DB / grid into points for final % math.
fn parse_earned_points(s: &str) -> f64 {
    let t = s.trim().replace(',', "");
    t.parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(0.0)
}

fn norm_header(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}

/// Read CSV, strip BOM, return records.
fn read_all_records(input: &str) -> Result<Vec<csv::StringRecord>, CsvError> {
    let text = strip_bom(input);
    if text.len() > 4_000_000 {
        return Err(CsvError::m("CSV is too large (max 4 MB)."));
    }
    let mut r = csv::Reader::from_reader(text.as_bytes());
    r.records()
        .map(|e| e.map_err(|e| CsvError::m(e.to_string())))
        .collect()
}

/// Validate CSV, diff against current `grades`, and produce ops. Does not require DB.
/// Plan 3.12: `current_excused` is used to diff excuse columns; export with ` (excuse)` per item.
pub fn validate_gradebook_import(
    csv_text: &str,
    students: &[(Uuid, String, String)],
    columns: &[CourseGradebookGridColumn],
    current_grades: &HashMap<Uuid, HashMap<Uuid, String>>,
    current_excused: &HashMap<Uuid, HashMap<Uuid, bool>>,
    course_kind: Option<DisplayGradingKind>,
    parsed_scale: Option<&ParsedScale>,
    types_map: &HashMap<Uuid, Option<String>>,
) -> Result<ValidatedImport, CsvError> {
    let recs = read_all_records(csv_text)?;
    if recs.len() < 3 {
        return Err(CsvError::m(
            "The CSV must include a header row, a metadata row, and at least one data row.",
        ));
    }
    let header: Vec<String> = recs[0].iter().map(String::from).collect();
    let meta: Vec<String> = recs[1].iter().map(String::from).collect();
    if header.len() < 5
        || meta.len() != header.len()
        || norm_header(&header[0]) != norm_header(H_STUDENT_ID)
        || norm_header(&header[1]) != norm_header(H_STUDENT_NAME)
        || norm_header(&header[2]) != norm_header(H_STUDENT_EMAIL)
    {
        return Err(CsvError::m("Missing required columns: student_id, student_name, student_email."));
    }
    if !meta[0].trim().eq_ignore_ascii_case(META_MARK) || !meta[1].trim().eq(META_V1) {
        return Err(CsvError::m("Missing or invalid Lextures metadata row (row 2). Re-export the gradebook from Lextures."));
    }

    let n_tail = 2;
    if header.len() < 3 + 2 + n_tail {
        return Err(CsvError::m("The CSV has no grade columns."));
    }
    let rest = header.len() - 3 - n_tail;
    let (triple_mode, n_slots) = if rest % 3 == 0
        && rest > 0
        && header
            .get(5)
            .is_some_and(|h| h.trim().ends_with(H_EXCUSE_SUFFIX))
    {
        (true, rest / 3)
    } else if rest % 2 == 0 {
        (false, rest / 2)
    } else {
        return Err(CsvError::m(
            "Grade columns must be (score) + (display) per item, or (score) + (display) + (excuse) (3.12).",
        ));
    };

    let col_by_id: HashMap<Uuid, &CourseGradebookGridColumn> =
        columns.iter().map(|c| (c.id, c)).collect();
    let mut col_order: Vec<Uuid> = Vec::with_capacity(n_slots);
    for k in 0..n_slots {
        let step: usize = if triple_mode { 3 } else { 2 };
        let s_idx = 3 + k * step;
        let m_id = &meta[s_idx + 0];
        if m_id.trim().is_empty() {
            return Err(CsvError::m("Missing assignment id in the metadata row."));
        }
        let aid = Uuid::parse_str(m_id.trim())
            .map_err(|_| CsvError::m("Invalid assignment id in metadata."))?;
        if !header[s_idx + 0].ends_with(H_SCORE_SUFFIX)
            || !header[s_idx + 1].ends_with(H_DISPLAY_SUFFIX)
        {
            return Err(CsvError::m("Each item must start with (score) and (display grade) headers."));
        }
        if triple_mode {
            if !header.get(s_idx + 2).is_some_and(|h| h.trim().ends_with(H_EXCUSE_SUFFIX)) {
                return Err(CsvError::m("Missing (excuse) column after (display grade) (3.12)."));
            }
        }
        let Some(c) = col_by_id.get(&aid) else {
            return Err(CsvError::m("Import references an assignment that is not in this course gradebook."));
        };
        if c.kind != "assignment" && c.kind != "quiz" {
            return Err(CsvError::m("Import references a non-gradable item."));
        }
        col_order.push(aid);
    }
    if norm_header(header.last().unwrap()) != norm_header(H_FINAL_GRADE)
        || norm_header(&header[header.len() - 2]) != norm_header(H_FINAL_SCORE)
    {
        return Err(CsvError::m(
            "Last two columns must be final_score and final_grade (informational only; not imported).",
        ));
    }

    let mut roster: HashSet<Uuid> = HashSet::new();
    for (id, _, _) in students {
        roster.insert(*id);
    }

    let mut stats = GradebookImportStats::default();
    let mut out_rows: Vec<GradebookImportPreviewRow> = vec![];
    let mut ops: Vec<GradebookUpsertOp> = vec![];
    let mut has_blocking = false;
    let mut data_student_seen: HashSet<Uuid> = HashSet::new();
    let step: usize = if triple_mode { 3 } else { 2 };

    for (ri, r) in recs.iter().enumerate().skip(2) {
        let r: Vec<String> = r.iter().map(String::from).collect();
        if r.is_empty() || r.iter().all(|s| s.trim().is_empty()) {
            continue;
        }
        if r.len() != header.len() {
            has_blocking = true;
            stats.errors += 1;
            out_rows.push(GradebookImportPreviewRow {
                row_index: ri,
                student_id: None,
                student_name: r.get(1).map(String::from),
                error: Some("This row has the wrong number of columns.".into()),
                cells: vec![],
            });
            continue;
        }

        let su = match Uuid::parse_str(r[0].trim()) {
            Ok(id) if roster.contains(&id) => id,
            Ok(_) => {
                has_blocking = true;
                stats.errors += 1;
                out_rows.push(GradebookImportPreviewRow {
                    row_index: ri,
                    student_id: None,
                    student_name: r.get(1).cloned(),
                    error: Some("This student is not in the course roster.".into()),
                    cells: vec![],
                });
                continue;
            }
            Err(_) => {
                has_blocking = true;
                stats.errors += 1;
                out_rows.push(GradebookImportPreviewRow {
                    row_index: ri,
                    student_id: None,
                    student_name: r.get(1).cloned(),
                    error: Some("Invalid student_id (must be a user UUID).".into()),
                    cells: vec![],
                });
                continue;
            }
        };
        if !data_student_seen.insert(su) {
            has_blocking = true;
            stats.errors += 1;
            out_rows.push(GradebookImportPreviewRow {
                row_index: ri,
                student_id: Some(su),
                student_name: r.get(1).cloned(),
                error: Some("Duplicate row for the same student_id. Remove or merge duplicate rows."
                    .into()),
                cells: vec![],
            });
            continue;
        }

        let mut row_cells: Vec<GradebookImportCellPreview> = vec![];
        let mut row_err: Option<String> = None;
        for (k, &aid) in col_order.iter().enumerate() {
            let col = col_by_id[&aid];
            let s_idx = 3 + k * step;
            let raw = r.get(s_idx).map_or("", |s| s).to_string();
            let raw_exc: Option<String> = if triple_mode {
                r.get(s_idx + 2).map(|s| s.to_string())
            } else {
                None
            };
            let before_ex = current_excused
                .get(&su)
                .and_then(|m| m.get(&aid))
                .copied()
                .unwrap_or(false);
            let ex_cell: Option<bool> = raw_exc
                .as_deref()
                .and_then(parse_csv_excuse_cell);
            if triple_mode
                && raw_exc
                    .as_deref()
                    .is_some_and(|s| !s.trim().is_empty() && ex_cell.is_none())
            {
                has_blocking = true;
                stats.errors += 1;
                row_err.get_or_insert("Invalid (excuse) value: use EX, 1, excused, 0, or no.".into());
            }
            let maxp = col.max_points.map(|m| m as f64);
            let ov = if col.kind == "assignment" {
                types_map.get(&aid).cloned().flatten()
            } else {
                None
            };
            let eff = resolve_effective(course_kind, ov.as_deref());
            let before = current_grades
                .get(&su)
                .and_then(|m| m.get(&aid))
                .map(|s| s.as_str().trim().to_string())
                .unwrap_or_default();
            let before_n = parse_earned_points(&before);

            if raw.trim().is_empty() {
                if let Some(true) = ex_cell {
                    if before_ex {
                        row_cells.push(GradebookImportCellPreview {
                            item_id: aid,
                            previous_score: if before.is_empty() {
                                None
                            } else {
                                Some(sanitize_for_export(&before))
                            },
                            new_score: "EX".into(),
                            state: "unchanged".to_string(),
                            out_of_range: false,
                        });
                        stats.unchanged += 1;
                    } else {
                        let bp = if before_n > 0.0 { before_n } else { 0.0 };
                        ops.push((su, aid, Some(bp), None, Some(true)));
                        row_cells.push(GradebookImportCellPreview {
                            item_id: aid,
                            previous_score: if before.is_empty() {
                                None
                            } else {
                                Some(sanitize_for_export(&before))
                            },
                            new_score: "EX".into(),
                            state: if before.is_empty() { "added" } else { "updated" }.to_string(),
                            out_of_range: false,
                        });
                        if before.is_empty() {
                            stats.added += 1
                        } else {
                            stats.updated += 1
                        };
                    }
                    continue;
                }
                if let Some(false) = ex_cell {
                    if before_ex {
                        if before_n > 0.0 {
                            ops.push((su, aid, Some(before_n), None, Some(false)));
                        } else {
                            ops.push((su, aid, Some(0.0), None, Some(false)));
                        }
                        row_cells.push(GradebookImportCellPreview {
                            item_id: aid,
                            previous_score: Some("EX".into()),
                            new_score: before.clone(),
                            state: "updated".to_string(),
                            out_of_range: false,
                        });
                        stats.updated += 1;
                    } else {
                        row_cells.push(GradebookImportCellPreview {
                            item_id: aid,
                            previous_score: None,
                            new_score: String::new(),
                            state: "unchanged".to_string(),
                            out_of_range: false,
                        });
                        stats.unchanged += 1;
                    }
                    continue;
                }
                if !before.is_empty() {
                    ops.push((su, aid, None, None, None));
                    row_cells.push(GradebookImportCellPreview {
                        item_id: aid,
                        previous_score: Some(sanitize_for_export(&before)),
                        new_score: String::new(),
                        state: "updated".to_string(),
                        out_of_range: false,
                    });
                    stats.updated += 1;
                } else {
                    row_cells.push(GradebookImportCellPreview {
                        item_id: aid,
                        previous_score: None,
                        new_score: String::new(),
                        state: "unchanged".to_string(),
                        out_of_range: false,
                    });
                    stats.unchanged += 1;
                }
                continue;
            }
            if import_cell_dangerous(&raw) {
                has_blocking = true;
                stats.errors += 1;
                row_err.get_or_insert(
                    "One or more cells use an unsafe or formula value (e.g. starting with = or @)."
                        .to_string(),
                );
                row_cells.push(GradebookImportCellPreview {
                    item_id: aid,
                    previous_score: if before.is_empty() {
                        None
                    } else {
                        Some(sanitize_for_export(&before))
                    },
                    new_score: raw,
                    state: "error".to_string(),
                    out_of_range: false,
                });
                continue;
            }
            match parse_gradebook_cell(
                &normalize_import_raw(&raw),
                maxp,
                parsed_scale,
                eff,
            ) {
                Ok(p) => {
                    let new_str = p
                        .map(|f| {
                            if (f as i64 as f64 - f).abs() < 1e-8 {
                                format!("{}", f as i64)
                            } else {
                                let mut t = format!("{:.4}", f);
                                while t.contains('.') && (t.ends_with('0') || t.ends_with('.')) {
                                    t.pop();
                                }
                                t
                            }
                        })
                        .unwrap_or_default();
                    let score_changed = before != new_str;
                    let ex_changed = triple_mode
                        && match ex_cell {
                            None => false,
                            Some(v) => v != before_ex,
                        };
                    if !score_changed && !ex_changed {
                        row_cells.push(GradebookImportCellPreview {
                            item_id: aid,
                            previous_score: if before.is_empty() {
                                None
                            } else {
                                Some(sanitize_for_export(&before))
                            },
                            new_score: new_str,
                            state: "unchanged".to_string(),
                            out_of_range: false,
                        });
                        stats.unchanged += 1;
                    } else {
                        let out_of_range = col
                            .max_points
                            .is_some_and(|mp| p.is_some() && p.unwrap() > mp as f64 + 1e-4);
                        if out_of_range {
                            stats.warnings += 1;
                        }
                        let set_ex: Option<bool> = if triple_mode { ex_cell } else { None };
                        ops.push((su, aid, p, None, set_ex));
                        let st = if before.is_empty() { "added" } else { "updated" };
                        if st == "added" {
                            stats.added += 1;
                        } else {
                            stats.updated += 1;
                        }
                        row_cells.push(GradebookImportCellPreview {
                            item_id: aid,
                            previous_score: if before.is_empty() {
                                None
                            } else {
                                Some(sanitize_for_export(&before))
                            },
                            new_score: sanitize_for_export(&new_str),
                            state: st.to_string(),
                            out_of_range,
                        });
                    }
                }
                Err(e) => {
                    has_blocking = true;
                    stats.errors += 1;
                    row_err.get_or_insert(e);
                    row_cells.push(GradebookImportCellPreview {
                        item_id: aid,
                        previous_score: if before.is_empty() {
                            None
                        } else {
                            Some(sanitize_for_export(&before))
                        },
                        new_score: raw,
                        state: "error".to_string(),
                        out_of_range: false,
                    });
                }
            }
        }
        out_rows.push(GradebookImportPreviewRow {
            row_index: ri,
            student_id: Some(su),
            student_name: r.get(1).cloned(),
            error: row_err,
            cells: row_cells,
        });
    }

    let ops = dedupe_ops(ops);
    Ok(ValidatedImport {
        ops,
        has_blocking_errors: has_blocking,
        rows: out_rows,
        stats,
    })
}

/// Last write wins for the same (student, assignment) if the file had redundant rows.
fn dedupe_ops(ops: Vec<GradebookUpsertOp>) -> Vec<GradebookUpsertOp> {
    let mut m: HashMap<
        (Uuid, Uuid),
        (Option<f64>, Option<HashMap<Uuid, f64>>, Option<bool>),
    > = HashMap::new();
    for (u, i, p, r, e) in ops {
        m.insert((u, i), (p, r, e));
    }
    m.into_iter()
        .map(|((u, i), (p, r, e))| (u, i, p, r, e))
        .collect()
}

fn normalize_import_raw(s: &str) -> String {
    let t = s.trim();
    t.strip_prefix('\'').unwrap_or(t).trim().to_string()
}

fn import_cell_dangerous(raw: &str) -> bool {
    let t = normalize_import_raw(raw);
    if t.is_empty() {
        return false;
    }
    t.starts_with('=') || t.starts_with('@') || t.starts_with('\t')
}

/// Result of structural + diff validation; caller checks moderated grading and blind hold.
pub struct ValidatedImport {
    pub ops: Vec<GradebookUpsertOp>,
    pub has_blocking_errors: bool,
    pub rows: Vec<GradebookImportPreviewRow>,
    pub stats: GradebookImportStats,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_injection() {
        assert_eq!(sanitize_for_export("=SUM(1)").as_str(), "'=SUM(1)");
        assert_eq!(sanitize_for_export("100").as_str(), "100");
    }
}
