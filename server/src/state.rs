use std::sync::Arc;

use sqlx::PgPool;
use uuid::Uuid;

use crate::jwt::JwtSigner;
use crate::services::ai::OpenRouterClient;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt: JwtSigner,
    /// When `None`, AI routes return [`crate::error::AppError::AiNotConfigured`].
    pub open_router: Option<Arc<OpenRouterClient>>,
    /// Realtime mailbox updates keyed by user id.
    pub comm_events: tokio::sync::broadcast::Sender<(Uuid, String)>,
}
