use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct MailboxParty {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Serialize)]
pub struct MailboxMessage {
    pub id: Uuid,
    pub from: MailboxParty,
    pub to: String,
    pub subject: String,
    pub snippet: String,
    pub body: String,
    pub sent_at: DateTime<Utc>,
    pub read: bool,
    pub starred: bool,
    pub folder: String,
    pub has_attachment: bool,
}

#[derive(Debug, Serialize)]
pub struct MailboxListResponse {
    pub messages: Vec<MailboxMessage>,
}

#[derive(Debug, Serialize)]
pub struct UnreadCountResponse {
    pub unread_inbox: i64,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub to_email: Option<String>,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Deserialize)]
pub struct PatchMailboxRequest {
    pub read: Option<bool>,
    pub starred: Option<bool>,
    pub folder: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SendMessageResponse {
    pub id: Uuid,
}
