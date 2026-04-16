use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Multipart, Path, State,
    },
    http::HeaderMap,
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::course_feed::{
    CreateFeedChannelRequest, CreateFeedMessageRequest, CreateFeedMessageResponse,
    FeedChannelPublic, FeedChannelsResponse, FeedMessagesResponse, FeedRosterResponse,
    PatchFeedMessageRequest, PinFeedMessageRequest,
};
use crate::models::course_file::CourseFileUploadResponse;
use crate::repos::course;
use crate::repos::course_feed;
use crate::repos::enrollment;
use crate::services::course_image_upload;
use crate::state::{AppState, FeedMessageActivity, FeedRealtimePayload, FeedRealtimeScope};

async fn require_course_access(
    state: &AppState,
    course_code: &str,
    user_id: Uuid,
) -> Result<(), AppError> {
    let ok = enrollment::user_has_access(&state.pool, course_code, user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(())
}

async fn resolve_course_id(state: &AppState, course_code: &str) -> Result<Uuid, AppError> {
    course::get_id_by_course_code(&state.pool, course_code)
        .await?
        .ok_or(AppError::NotFound)
}

fn feed_publish(state: &AppState, course_id: Uuid, scope: FeedRealtimeScope) {
    let _ = state.feed_events.send(FeedRealtimePayload { course_id, scope });
}

fn feed_event_json(payload: &FeedRealtimePayload) -> String {
    match &payload.scope {
        FeedRealtimeScope::Channels => r#"{"type":"feed","scope":"channels"}"#.to_string(),
        FeedRealtimeScope::Messages {
            channel_id,
            activity,
            actor_user_id,
        } => json!({
            "type": "feed",
            "scope": "messages",
            "channelId": channel_id,
            "activity": activity.as_str(),
            "actorUserId": actor_user_id,
        })
        .to_string(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedWsAuthMessage {
    auth_token: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/feed/channels",
            get(list_channels_handler).post(create_channel_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/feed/ws",
            get(feed_ws_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/feed/roster",
            get(roster_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/feed/upload-image",
            post(upload_feed_image_handler).layer(DefaultBodyLimit::max(25 * 1024 * 1024)),
        )
        .route(
            "/api/v1/courses/{course_code}/feed/channels/{channel_id}/messages",
            get(list_messages_handler).post(create_message_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/feed/messages/{message_id}",
            patch(patch_message_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/feed/messages/{message_id}/pin",
            patch(pin_message_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/feed/messages/{message_id}/like",
            post(like_message_handler).delete(unlike_message_handler),
        )
}

async fn list_channels_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<FeedChannelsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let channels = course_feed::list_channels(&state.pool, course_id, user.user_id).await?;
    Ok(Json(FeedChannelsResponse { channels }))
}

async fn create_channel_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateFeedChannelRequest>,
) -> Result<Json<FeedChannelPublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let name = req.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(AppError::InvalidInput(
            "Channel name must be 1–80 characters.".into(),
        ));
    }
    let ch = course_feed::create_channel(&state.pool, course_id, user.user_id, name).await?;
    feed_publish(&state, course_id, FeedRealtimeScope::Channels);
    Ok(Json(ch))
}

async fn roster_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<FeedRosterResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let people = course_feed::list_roster(&state.pool, course_id).await?;
    Ok(Json(FeedRosterResponse { people }))
}

async fn upload_feed_image_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<CourseFileUploadResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let (bytes, original_filename, mime_type) =
        course_image_upload::ingest_multipart_image_field(&mut multipart).await?;

    let resp = course_image_upload::persist_course_image(
        &state.pool,
        &state.course_files_root,
        course_row.id,
        &course_code,
        user.user_id,
        bytes,
        original_filename,
        mime_type,
    )
    .await?;

    Ok(Json(resp))
}

async fn list_messages_handler(
    State(state): State<AppState>,
    Path((course_code, channel_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<FeedMessagesResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    if !course_feed::channel_belongs_to_course(&state.pool, course_id, channel_id).await? {
        return Err(AppError::NotFound);
    }
    let messages =
        course_feed::list_messages_threaded(&state.pool, channel_id, user.user_id, 60).await?;
    Ok(Json(FeedMessagesResponse { messages }))
}

async fn create_message_handler(
    State(state): State<AppState>,
    Path((course_code, channel_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateFeedMessageRequest>,
) -> Result<Json<CreateFeedMessageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    if !course_feed::channel_belongs_to_course(&state.pool, course_id, channel_id).await? {
        return Err(AppError::NotFound);
    }

    let body = req.body.trim();
    if body.is_empty() || body.len() > 8000 {
        return Err(AppError::InvalidInput(
            "Message body must be 1–8000 characters.".into(),
        ));
    }

    if req.mentions_everyone
        && !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?
    {
        return Err(AppError::Forbidden);
    }

    if let Some(pid) = req.parent_message_id {
        if !course_feed::parent_is_root_in_channel(&state.pool, channel_id, pid).await? {
            return Err(AppError::InvalidInput(
                "Replies must reference a top-level message in this channel.".into(),
            ));
        }
    }

    let enrolled = course_feed::enrolled_user_ids(&state.pool, course_id).await?;
    let mut mention_ids: Vec<Uuid> = req
        .mention_user_ids
        .iter()
        .copied()
        .filter(|id| enrolled.contains(id))
        .collect();
    mention_ids.sort_unstable();
    mention_ids.dedup();
    if mention_ids.len() > 40 {
        return Err(AppError::InvalidInput("Too many @mentions.".into()));
    }

    let id = course_feed::create_message(
        &state.pool,
        channel_id,
        user.user_id,
        body,
        req.parent_message_id,
        &mention_ids,
        req.mentions_everyone,
    )
    .await?;

    feed_publish(
        &state,
        course_id,
        FeedRealtimeScope::Messages {
            channel_id,
            activity: FeedMessageActivity::Post,
            actor_user_id: user.user_id,
        },
    );

    Ok(Json(CreateFeedMessageResponse { id }))
}

async fn patch_message_handler(
    State(state): State<AppState>,
    Path((course_code, message_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchFeedMessageRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some((ch_id, _author, _)) = course_feed::message_meta(&state.pool, course_id, message_id).await?
    else {
        return Err(AppError::NotFound);
    };

    let body = req.body.trim();
    if body.is_empty() || body.len() > 8000 {
        return Err(AppError::InvalidInput(
            "Message body must be 1–8000 characters.".into(),
        ));
    }

    let ok = course_feed::update_message_body(&state.pool, message_id, user.user_id, body).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    feed_publish(
        &state,
        course_id,
        FeedRealtimeScope::Messages {
            channel_id: ch_id,
            activity: FeedMessageActivity::Edit,
            actor_user_id: user.user_id,
        },
    );
    Ok(Json(json!({ "ok": true })))
}

async fn pin_message_handler(
    State(state): State<AppState>,
    Path((course_code, message_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PinFeedMessageRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some((ch_id, _, _)) = course_feed::message_meta(&state.pool, course_id, message_id).await?
    else {
        return Err(AppError::NotFound);
    };

    let ok =
        course_feed::set_pinned(&state.pool, course_id, message_id, req.pinned, user.user_id)
            .await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    feed_publish(
        &state,
        course_id,
        FeedRealtimeScope::Messages {
            channel_id: ch_id,
            activity: FeedMessageActivity::Pin,
            actor_user_id: user.user_id,
        },
    );
    Ok(Json(json!({ "ok": true })))
}

async fn like_message_handler(
    State(state): State<AppState>,
    Path((course_code, message_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some((ch_id, _, _)) = course_feed::message_meta(&state.pool, course_id, message_id).await?
    else {
        return Err(AppError::NotFound);
    };
    course_feed::add_like(&state.pool, message_id, user.user_id).await?;
    feed_publish(
        &state,
        course_id,
        FeedRealtimeScope::Messages {
            channel_id: ch_id,
            activity: FeedMessageActivity::Like,
            actor_user_id: user.user_id,
        },
    );
    Ok(Json(json!({ "ok": true })))
}

async fn unlike_message_handler(
    State(state): State<AppState>,
    Path((course_code, message_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some((ch_id, _, _)) = course_feed::message_meta(&state.pool, course_id, message_id).await?
    else {
        return Err(AppError::NotFound);
    };
    course_feed::remove_like(&state.pool, message_id, user.user_id).await?;
    feed_publish(
        &state,
        course_id,
        FeedRealtimeScope::Messages {
            channel_id: ch_id,
            activity: FeedMessageActivity::Like,
            actor_user_id: user.user_id,
        },
    );
    Ok(Json(json!({ "ok": true })))
}

/// `WebSocketUpgrade` must be the last extractor or the handshake will not complete.
async fn feed_ws_handler(
    Path(course_code): Path<String>,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    Ok(ws.on_upgrade(move |socket| handle_feed_ws(socket, state, course_code)))
}

async fn read_feed_ws_user_id(socket: &mut WebSocket, state: &AppState) -> Option<Uuid> {
    let text = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(t))) => break t,
            Some(Ok(Message::Ping(p))) => {
                let _ = socket.send(Message::Pong(p)).await;
            }
            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return None,
            _ => {}
        }
    };
    let auth: FeedWsAuthMessage = match serde_json::from_str(&text) {
        Ok(a) => a,
        Err(_) => return None,
    };
    state.jwt.verify(&auth.auth_token).ok().map(|u| u.user_id)
}

async fn handle_feed_ws(mut socket: WebSocket, state: AppState, course_code: String) {
    let Some(user_id) = read_feed_ws_user_id(&mut socket, &state).await else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    };
    if require_course_access(&state, &course_code, user_id).await.is_err() {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }
    let Ok(course_id) = resolve_course_id(&state, &course_code).await else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    };
    let mut rx = state.feed_events.subscribe();
    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(p))) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            r = rx.recv() => {
                match r {
                    Ok(payload) if payload.course_id == course_id => {
                        let text = feed_event_json(&payload);
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Ok(_) => {}
                }
            }
        }
    }
}
