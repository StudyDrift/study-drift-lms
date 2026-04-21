//! Standards frameworks, CASE / JSON import, and coverage helpers.

use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::standards::{
    self, StandardCodeRow, StandardCoverageRow, StandardFrameworkRow,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LexturesFrameworkInput {
    pub code: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub publisher: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LexturesItemInput {
    pub code: String,
    #[serde(default)]
    pub short_code: Option<String>,
    pub description: String,
    #[serde(default)]
    pub grade_band: Option<String>,
    #[serde(default = "default_depth")]
    pub depth_level: i16,
    #[serde(default)]
    pub parent_code: Option<String>,
}

fn default_depth() -> i16 {
    4
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LexturesBundle {
    framework: LexturesFrameworkInput,
    items: Vec<LexturesItemInput>,
}

#[derive(Debug)]
pub(crate) struct ImportItem {
    code: String,
    short_code: Option<String>,
    description: String,
    grade_band: Option<String>,
    depth_level: i16,
    parent_code: Option<String>,
}

#[derive(Debug)]
pub struct StandardsImportOutcome {
    pub framework: StandardFrameworkRow,
    pub record_count: usize,
}

fn value_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => n.as_i64().map(|i| i.to_string()),
        _ => None,
    }
}

fn case_item_identifier(item: &Value) -> Option<String> {
    item.get("identifier")
        .and_then(|x| value_str(x))
        .or_else(|| item.get("uri").and_then(|u| u.as_str().map(|s| s.to_string())))
}

fn case_item_code(item: &Value) -> Option<String> {
    item.get("humanCodingScheme")
        .and_then(value_str)
        .or_else(|| item.get("statementCode").and_then(value_str))
        .or_else(|| case_item_identifier(item))
}

fn case_item_description(item: &Value) -> String {
    item.get("fullStatement")
        .or_else(|| item.get("notes"))
        .and_then(value_str)
        .unwrap_or_default()
}

fn case_education_level(item: &Value) -> Option<String> {
    let Some(levels) = item.get("educationLevel").and_then(|x| x.as_array()) else {
        return None;
    };
    let mut out: Vec<String> = Vec::new();
    for l in levels {
        if let Some(s) = value_str(l) {
            let t = s.trim();
            if t.len() == 2 && t.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(n) = t.parse::<i32>() {
                    out.push(n.to_string());
                } else {
                    out.push(t.to_string());
                }
            } else {
                out.push(t.to_string());
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out.join(","))
    }
}

fn parse_case_items(root: &Value) -> Result<(LexturesFrameworkInput, Vec<ImportItem>), AppError> {
    let doc = root
        .get("CFDocument")
        .ok_or_else(|| AppError::invalid_input("CASE import requires a CFDocument object."))?;

    let name = doc
        .get("title")
        .or_else(|| doc.get("subject"))
        .and_then(value_str)
        .unwrap_or_else(|| "Imported standards framework".to_string());

    let version = doc
        .get("publicationStatus")
        .or_else(|| doc.get("adoptionStatus"))
        .and_then(value_str)
        .unwrap_or_else(|| "1".to_string());

    let code = doc
        .get("identifier")
        .and_then(value_str)
        .map(|s| {
            let slug: String = s
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect::<String>()
                .trim_matches('-')
                .to_ascii_lowercase();
            if slug.is_empty() {
                "case-import".to_string()
            } else {
                slug
            }
        })
        .unwrap_or_else(|| "case-import".to_string());

    let items_arr = root
        .get("CFItems")
        .and_then(|x| x.as_array())
        .ok_or_else(|| AppError::invalid_input("CASE import requires CFItems array."))?;

    let mut child_to_parent: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if let Some(assocs) = root.get("CFAssociations").and_then(|x| x.as_array()) {
        for a in assocs {
            let assoc_type = a
                .get("associationType")
                .and_then(value_str)
                .unwrap_or_default();
            if !assoc_type.to_ascii_lowercase().contains("childof") {
                continue;
            }
            let origin = a
                .get("originNodeURI")
                .and_then(|o| o.get("uri"))
                .and_then(value_str)
                .or_else(|| a.get("originNodeURI").and_then(value_str));
            let dest = a
                .get("destinationNodeURI")
                .and_then(|o| o.get("uri"))
                .and_then(value_str)
                .or_else(|| a.get("destinationNodeURI").and_then(value_str));
            let (Some(ou), Some(du)) = (origin, dest) else {
                continue;
            };
            let origin_id = ou.split('/').next_back().unwrap_or(&ou).to_string();
            let dest_id = du.split('/').next_back().unwrap_or(&du).to_string();
            if !origin_id.is_empty() && !dest_id.is_empty() {
                child_to_parent.insert(origin_id, dest_id);
            }
        }
    }

    let id_to_code: std::collections::HashMap<String, String> = items_arr
        .iter()
        .filter_map(|it| {
            let id = case_item_identifier(it)?;
            let code = case_item_code(it)?;
            Some((id, code))
        })
        .collect();

    let mut out: Vec<ImportItem> = Vec::new();
    for it in items_arr {
        let Some(code) = case_item_code(it) else {
            continue;
        };
        let description = case_item_description(it);
        if description.is_empty() {
            continue;
        }
        let grade_band = case_education_level(it);
        let identifier = case_item_identifier(it).unwrap_or_default();
        let parent_code = child_to_parent.get(&identifier).and_then(|pid| {
            id_to_code
                .get(pid)
                .cloned()
                .or_else(|| Some(pid.clone()))
        });
        let depth_level: i16 = it
            .get("CFItemType")
            .and_then(value_str)
            .map(|t| match t.to_ascii_lowercase().as_str() {
                "domain" => 1,
                "cluster" | "concept" => 2,
                "standard" => 4,
                _ => 3,
            })
            .unwrap_or(4);

        out.push(ImportItem {
            code,
            short_code: None,
            description,
            grade_band,
            depth_level,
            parent_code,
        });
    }

    Ok((
        LexturesFrameworkInput {
            code,
            name,
            version,
            publisher: doc.get("publisher").and_then(value_str),
        },
        out,
    ))
}

fn parse_lextures_bundle(b: LexturesBundle) -> (LexturesFrameworkInput, Vec<ImportItem>) {
    let items = b
        .items
        .into_iter()
        .map(|i| ImportItem {
            code: i.code,
            short_code: i.short_code,
            description: i.description,
            grade_band: i.grade_band,
            depth_level: i.depth_level,
            parent_code: i.parent_code,
        })
        .collect();
    (b.framework, items)
}

/// Parses CASE 1.0-style JSON or a compact `framework` + `items` bundle.
pub(crate) fn parse_standards_import(
    body: &Value,
) -> Result<(LexturesFrameworkInput, Vec<ImportItem>), AppError> {
    if body.get("CFDocument").is_some() {
        parse_case_items(body)
    } else if body.get("framework").is_some() {
        let b: LexturesBundle = serde_json::from_value(body.clone())
            .map_err(|e| AppError::invalid_input(format!("Invalid standards import JSON: {e}")))?;
        Ok(parse_lextures_bundle(b))
    } else {
        Err(AppError::invalid_input(
            "Unrecognized standards document: expected CFDocument (CASE) or framework/items bundle.",
        ))
    }
}

pub async fn import_standards(
    pool: &PgPool,
    body: &Value,
    _actor_user_id: Uuid,
) -> Result<StandardsImportOutcome, AppError> {
    let (fw_in, mut items) = parse_standards_import(body)?;
    let fw = standards::upsert_framework(
        pool,
        fw_in.code.trim(),
        fw_in.name.trim(),
        fw_in.version.trim(),
        fw_in.publisher.as_deref().map(str::trim),
    )
    .await
    .map_err(AppError::Db)?;

    items.sort_by(|a, b| a.depth_level.cmp(&b.depth_level).then_with(|| a.code.cmp(&b.code)));

    let mut code_to_id: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();
    let mut count = 0usize;
    for it in &items {
        let parent_id = it
            .parent_code
            .as_ref()
            .and_then(|pc| code_to_id.get(pc.as_str()).copied());
        let row = standards::upsert_standard_code(
            pool,
            fw.id,
            parent_id,
            &it.code,
            it.short_code.as_deref(),
            &it.description,
            it.grade_band.as_deref(),
            it.depth_level,
        )
        .await
        .map_err(AppError::Db)?;
        code_to_id.insert(it.code.clone(), row.id);
        count += 1;
    }

    tracing::info!(
        target: "standards_alignment",
        framework_code = %fw.code,
        framework_version = %fw.version,
        record_count = count,
        "standards.import_completed"
    );

    Ok(StandardsImportOutcome {
        framework: fw,
        record_count: count,
    })
}

pub async fn list_standards_for_query(
    pool: &PgPool,
    framework_code: &str,
    grade: Option<&str>,
    q: Option<&str>,
) -> Result<Vec<StandardCodeRow>, AppError> {
    let fw = standards::get_latest_framework_by_code(pool, framework_code.trim())
        .await
        .map_err(AppError::Db)?
        .ok_or_else(|| AppError::NotFound)?;
    let rows = standards::list_standard_codes(pool, fw.id, grade, q, 2500)
        .await
        .map_err(AppError::Db)?;
    Ok(rows)
}

pub async fn search_standards(
    pool: &PgPool,
    framework_code: &str,
    q: &str,
) -> Result<Vec<StandardCodeRow>, AppError> {
    let fw = standards::get_latest_framework_by_code(pool, framework_code.trim())
        .await
        .map_err(AppError::Db)?
        .ok_or_else(|| AppError::NotFound)?;
    if q.trim().is_empty() {
        return Ok(vec![]);
    }
    let rows = standards::search_standard_codes(pool, fw.id, q.trim(), 200)
        .await
        .map_err(AppError::Db)?;
    Ok(rows)
}

pub async fn course_standards_coverage(
    pool: &PgPool,
    course_id: Uuid,
    framework_code: &str,
    grade: Option<&str>,
) -> Result<Vec<StandardCoverageRow>, AppError> {
    let fw = standards::get_latest_framework_by_code(pool, framework_code.trim())
        .await
        .map_err(AppError::Db)?
        .ok_or_else(|| AppError::NotFound)?;
    let rows =
        standards::standards_coverage_for_course(pool, course_id, fw.id, grade)
            .await
            .map_err(AppError::Db)?;
    Ok(rows)
}
