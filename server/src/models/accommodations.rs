//! API types for student accommodations (plan 2.11).

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MANAGE_ACCOMMODATIONS_PERM: &str = "global:user:accommodations:manage";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccommodationSummaryPublic {
    pub has_accommodation: bool,
    pub flags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccommodationUserSearchHit {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sid: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccommodationUserSearchResponse {
    pub users: Vec<AccommodationUserSearchHit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentAccommodationApi {
    pub id: Uuid,
    pub user_id: Uuid,
    pub course_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub course_code: Option<String>,
    pub time_multiplier: f64,
    pub extra_attempts: i32,
    pub hints_always_enabled: bool,
    pub reduced_distraction_mode: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternative_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_from: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_until: Option<NaiveDate>,
    pub created_by: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudentAccommodationRequest {
    /// When omitted or empty, the record applies to all courses for this learner.
    #[serde(default)]
    pub course_code: Option<String>,
    #[serde(default = "default_time_multiplier")]
    pub time_multiplier: f64,
    #[serde(default)]
    pub extra_attempts: i32,
    #[serde(default)]
    pub hints_always_enabled: bool,
    #[serde(default)]
    pub reduced_distraction_mode: bool,
    #[serde(default)]
    pub alternative_format: Option<String>,
    #[serde(default)]
    pub effective_from: Option<NaiveDate>,
    #[serde(default)]
    pub effective_until: Option<NaiveDate>,
}

fn default_time_multiplier() -> f64 {
    1.0
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStudentAccommodationRequest {
    pub time_multiplier: f64,
    pub extra_attempts: i32,
    pub hints_always_enabled: bool,
    pub reduced_distraction_mode: bool,
    #[serde(default)]
    pub alternative_format: Option<String>,
    #[serde(default)]
    pub effective_from: Option<NaiveDate>,
    #[serde(default)]
    pub effective_until: Option<NaiveDate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyAccommodationsResponse {
    pub accommodations: Vec<MyAccommodationEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyAccommodationEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub course_code: Option<String>,
    pub has_extended_time: bool,
    pub has_extra_attempts: bool,
    pub hints_always_available: bool,
    pub reduced_distraction_recommended: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_from: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_until: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccommodationUserSearchQuery {
    #[serde(default)]
    pub q: String,
}
