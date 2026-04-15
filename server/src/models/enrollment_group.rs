use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentGroupMembershipPublic {
    pub group_set_id: Uuid,
    pub group_id: Uuid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentGroupPublic {
    pub id: Uuid,
    pub name: String,
    pub sort_order: i32,
    pub enrollment_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentGroupSetPublic {
    pub id: Uuid,
    pub name: String,
    pub sort_order: i32,
    pub groups: Vec<EnrollmentGroupPublic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentGroupsTreeResponse {
    pub group_sets: Vec<EnrollmentGroupSetPublic>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnrollmentGroupSetRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnrollmentGroupRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchEnrollmentGroupSetRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchEnrollmentGroupRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutEnrollmentGroupMembershipRequest {
    pub enrollment_id: Uuid,
    pub group_set_id: Uuid,
    /// When omitted or null, removes membership for this set (unassigned).
    #[serde(default)]
    pub group_id: Option<Uuid>,
}
