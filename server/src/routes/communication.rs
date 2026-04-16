use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::HeaderMap,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::communication::{
    MailboxListResponse, PatchMailboxRequest, SendMessageRequest, SendMessageResponse,
    UnreadCountResponse,
};
use crate::repos::communication;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListQuery {
    folder: String,
    #[serde(default)]
    q: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WsAuthMessage {
    auth_token: String,
}

fn notify_mailbox(state: &AppState, user_id: Uuid) {
    let _ = state
        .comm_events
        .send((user_id, r#"{"type":"mailbox_updated"}"#.to_string()));
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/communication/messages",
            get(list_handler).post(send_handler),
        )
        .route(
            "/api/v1/communication/messages/{id}",
            get(get_handler).patch(patch_handler),
        )
        .route("/api/v1/communication/unread-count", get(unread_handler))
        .route("/api/v1/communication/ws", get(ws_handler))
}

fn validate_folder(folder: &str) -> Result<(), AppError> {
    match folder {
        "inbox" | "starred" | "sent" | "drafts" | "trash" => Ok(()),
        _ => Err(AppError::InvalidInput("Invalid folder.".into())),
    }
}

fn validate_mailbox_folder(folder: &str) -> Result<(), AppError> {
    match folder {
        "inbox" | "sent" | "drafts" | "trash" => Ok(()),
        _ => Err(AppError::InvalidInput("Invalid folder.".into())),
    }
}

async fn list_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListQuery>,
) -> Result<Json<MailboxListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    validate_folder(&q.folder)?;
    let messages = communication::list_for_user(&state.pool, user.user_id, &q.folder, &q.q).await?;
    Ok(Json(MailboxListResponse { messages }))
}

async fn get_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<crate::models::communication::MailboxMessage>, AppError> {
    let user = auth_user(&state, &headers)?;
    let msg = communication::get_for_user(&state.pool, user.user_id, id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(msg))
}

async fn unread_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UnreadCountResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let unread_inbox = communication::count_unread_inbox(&state.pool, user.user_id).await?;
    Ok(Json(UnreadCountResponse { unread_inbox }))
}

async fn send_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<SendMessageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let subject = req.subject.trim();
    let body = req.body.trim();

    if req.draft {
        let id = communication::save_draft(&state.pool, user.user_id, subject, body).await?;
        notify_mailbox(&state, user.user_id);
        return Ok(Json(SendMessageResponse { id }));
    }

    let to_email = req
        .to_email
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::InvalidInput("to_email is required to send.".into()))?;

    let id = communication::send_message(&state.pool, user.user_id, to_email, subject, body)
        .await?
        .ok_or_else(|| AppError::InvalidInput("No user registered with that email.".into()))?;

    notify_mailbox(&state, user.user_id);
    if let Some(recipient) = crate::repos::user::find_by_email(&state.pool, to_email).await? {
        if recipient.id != user.user_id {
            notify_mailbox(&state, recipient.id);
        }
    }

    Ok(Json(SendMessageResponse { id }))
}

async fn patch_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<PatchMailboxRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    if let Some(ref f) = req.folder {
        validate_mailbox_folder(f)?;
    }
    let ok = communication::update_mailbox(&state.pool, user.user_id, id, &req).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    notify_mailbox(&state, user.user_id);
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// `WebSocketUpgrade` must be the last extractor or the handshake will not complete.
async fn ws_handler(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    Ok(ws.on_upgrade(move |socket| handle_ws(socket, state)))
}

async fn read_ws_user_id(socket: &mut WebSocket, state: &AppState) -> Option<Uuid> {
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
    let auth: WsAuthMessage = match serde_json::from_str(&text) {
        Ok(a) => a,
        Err(_) => return None,
    };
    state.jwt.verify(&auth.auth_token).ok().map(|u| u.user_id)
}

async fn handle_ws(mut socket: WebSocket, state: AppState) {
    let Some(user_id) = read_ws_user_id(&mut socket, &state).await else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    };
    let mut rx = state.comm_events.subscribe();
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
                    Ok((uid, text)) if uid == user_id => {
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
