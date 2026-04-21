use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::repos::standards::{StandardCodeRow, StandardCoverageRow, StandardFrameworkRow};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardFrameworkBrief {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub version: String,
}

impl From<&StandardFrameworkRow> for StandardFrameworkBrief {
    fn from(f: &StandardFrameworkRow) -> Self {
        StandardFrameworkBrief {
            id: f.id,
            code: f.code.clone(),
            name: f.name.clone(),
            version: f.version.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardCodeApi {
    pub id: Uuid,
    pub framework: StandardFrameworkBrief,
    pub parent_id: Option<Uuid>,
    pub code: String,
    pub short_code: Option<String>,
    pub description: String,
    pub grade_band: Option<String>,
    pub depth_level: i16,
    pub superseded: bool,
    pub superseded_by_standard_code_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardsImportResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<Uuid>,
    pub framework_code: String,
    pub record_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardCoverageApi {
    pub standard_code_id: Uuid,
    pub code: String,
    pub short_code: Option<String>,
    pub description: String,
    pub grade_band: Option<String>,
    pub question_count: i64,
    pub average_mastery: Option<f64>,
    pub coverage_status: String,
    pub superseded: bool,
    pub superseded_by_standard_code_id: Option<Uuid>,
}

impl From<StandardCoverageRow> for StandardCoverageApi {
    fn from(r: StandardCoverageRow) -> Self {
        let superseded = r.archived_at.is_some() || r.superseded_by_standard_code_id.is_some();
        StandardCoverageApi {
            standard_code_id: r.standard_code_id,
            code: r.code,
            short_code: r.short_code,
            description: r.description,
            grade_band: r.grade_band,
            question_count: r.question_count,
            average_mastery: r.average_mastery,
            coverage_status: r.coverage_status,
            superseded,
            superseded_by_standard_code_id: r.superseded_by_standard_code_id,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseStandardsCoverageResponse {
    pub standards: Vec<StandardCoverageApi>,
}

impl StandardCodeApi {
    pub fn from_row(row: StandardCodeRow, fw: &StandardFrameworkRow) -> Self {
        let superseded = row.archived_at.is_some() || row.superseded_by_standard_code_id.is_some();
        StandardCodeApi {
            id: row.id,
            framework: StandardFrameworkBrief::from(fw),
            parent_id: row.parent_id,
            code: row.code,
            short_code: row.short_code,
            description: row.description,
            grade_band: row.grade_band,
            depth_level: row.depth_level,
            superseded,
            superseded_by_standard_code_id: row.superseded_by_standard_code_id,
            created_at: row.created_at,
        }
    }
}
