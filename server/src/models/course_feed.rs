use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FeedChannelPublic {
    pub id: Uuid,
    pub name: String,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FeedRosterPerson {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedMessagePublic {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_user_id: Uuid,
    pub author_email: String,
    pub author_display_name: Option<String>,
    pub parent_message_id: Option<Uuid>,
    pub body: String,
    pub mentions_everyone: bool,
    pub mention_user_ids: Vec<Uuid>,
    pub pinned_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
    pub like_count: i64,
    pub viewer_has_liked: bool,
    pub replies: Vec<FeedMessagePublic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedChannelsResponse {
    pub channels: Vec<FeedChannelPublic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRosterResponse {
    pub people: Vec<FeedRosterPerson>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedMessagesResponse {
    pub messages: Vec<FeedMessagePublic>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFeedChannelRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFeedMessageRequest {
    pub body: String,
    #[serde(default)]
    pub parent_message_id: Option<Uuid>,
    #[serde(default)]
    pub mention_user_ids: Vec<Uuid>,
    #[serde(default)]
    pub mentions_everyone: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFeedMessageRequest {
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinFeedMessageRequest {
    pub pinned: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFeedMessageResponse {
    pub id: Uuid,
}
