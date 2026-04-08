use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyPermissionsResponse {
    pub permission_strings: Vec<String>,
}
