use std::path::PathBuf;
use std::sync::Arc;

use sqlx::PgPool;
use uuid::Uuid;

use crate::jwt::JwtSigner;
use crate::lti_keys::LtiRuntime;
use crate::services::ai::OpenRouterClient;

/// What triggered a [`FeedRealtimeScope::Messages`] event (for client UX such as unread badges).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeedMessageActivity {
    Post,
    Edit,
    Pin,
    Like,
}

impl FeedMessageActivity {
    pub const fn as_str(self) -> &'static str {
        match self {
            FeedMessageActivity::Post => "post",
            FeedMessageActivity::Edit => "edit",
            FeedMessageActivity::Pin => "pin",
            FeedMessageActivity::Like => "like",
        }
    }
}

/// Realtime course feed updates (broadcast to enrolled clients watching that course).
#[derive(Clone, Debug)]
pub enum FeedRealtimeScope {
    /// Channel list may have changed.
    Channels,
    /// Messages in a single channel may have changed.
    Messages {
        channel_id: Uuid,
        activity: FeedMessageActivity,
        /// User who posted, edited, liked, or pinned (clients may ignore self-authored posts for badges).
        actor_user_id: Uuid,
    },
}

#[derive(Clone, Debug)]
pub struct FeedRealtimePayload {
    pub course_id: Uuid,
    pub scope: FeedRealtimeScope,
}

/// Outbound email (password reset, etc.). When `smtp_host` is `None`, mail is not sent over SMTP.
#[derive(Clone, Debug)]
pub struct MailSettings {
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_user: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt: JwtSigner,
    /// When `None`, AI routes return [`crate::error::AppError::AiNotConfigured`].
    pub open_router: Option<Arc<OpenRouterClient>>,
    /// Realtime mailbox updates keyed by user id.
    pub comm_events: tokio::sync::broadcast::Sender<(Uuid, String)>,
    /// Realtime course feed updates (course id + scope).
    pub feed_events: tokio::sync::broadcast::Sender<FeedRealtimePayload>,
    /// On-disk root for `course.course_files` blobs (`<root>/<course_code>/<storage_key>`).
    pub course_files_root: PathBuf,
    /// Policy allowlist for Canvas import base URL hosts.
    pub canvas_allowed_host_suffixes: Vec<String>,
    /// Base URL of the SPA (no trailing slash), used to build password-reset links.
    pub public_web_origin: String,
    pub mail: MailSettings,
    /// LTI 1.3 signing + issuer settings. `None` when LTI is disabled or misconfigured.
    pub lti: Option<Arc<LtiRuntime>>,
    /// Plan 3.1 — inline PDF/image annotation APIs + grader surfaces.
    pub annotation_enabled: bool,
    /// Plan 3.2 — instructor A/V feedback on assignment submissions.
    pub feedback_media_enabled: bool,
    /// Plan 3.3 — server-side PII redaction for blind grading.
    pub blind_grading_enabled: bool,
    /// Plan 3.4 — provisional graders + moderator reconciliation APIs.
    pub moderated_grading_enabled: bool,
    /// Plan 3.5 — plagiarism / AI originality pipeline.
    pub originality_detection_enabled: bool,
    /// When true, external similarity completes immediately with placeholder scores (local QA).
    pub originality_stub_external: bool,
    /// Plan 3.8 — grade hold/post and scheduled release.
    pub grade_posting_policies_enabled: bool,
}
