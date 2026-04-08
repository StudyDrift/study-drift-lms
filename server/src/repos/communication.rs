use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::models::communication::{MailboxMessage, MailboxParty, PatchMailboxRequest};
use crate::repos::user;

#[derive(Debug, sqlx::FromRow)]
struct ListRow {
    message_id: Uuid,
    #[allow(dead_code)]
    sender_user_id: Uuid,
    #[allow(dead_code)]
    recipient_user_id: Option<Uuid>,
    subject: String,
    body: String,
    snippet: String,
    has_attachment: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    folder: String,
    read_at: Option<chrono::DateTime<chrono::Utc>>,
    starred: bool,
    sender_email: String,
    sender_display_name: Option<String>,
    recipient_email: Option<String>,
}

pub fn make_snippet(body: &str) -> String {
    let count = body.chars().count();
    let head: String = body.chars().take(120).collect();
    if count > 120 {
        format!("{head}…")
    } else {
        head
    }
}

fn row_to_public(row: ListRow) -> MailboxMessage {
    let sender_name = row
        .sender_display_name
        .clone()
        .unwrap_or_else(|| row.sender_email.clone());
    let from = MailboxParty {
        name: sender_name,
        email: row.sender_email,
    };
    let to = row.recipient_email.unwrap_or_default();
    let read = match row.folder.as_str() {
        "inbox" => row.read_at.is_some(),
        _ => true,
    };
    MailboxMessage {
        id: row.message_id,
        from,
        to,
        subject: row.subject,
        snippet: row.snippet,
        body: row.body,
        sent_at: row.created_at,
        read,
        starred: row.starred,
        folder: row.folder,
        has_attachment: row.has_attachment,
    }
}

pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    folder: &str,
    q: &str,
) -> Result<Vec<MailboxMessage>, sqlx::Error> {
    let pattern = q.trim();
    let search: Option<String> = if pattern.is_empty() {
        None
    } else {
        Some(format!("%{pattern}%"))
    };

    let rows: Vec<ListRow> = if let Some(s) = search {
        sqlx::query_as::<_, ListRow>(&format!(
            r#"
            SELECT
              m.id AS message_id,
              m.sender_user_id,
              m.recipient_user_id,
              m.subject,
              m.body,
              m.snippet,
              m.has_attachment,
              m.created_at,
              mb.folder,
              mb.read_at,
              mb.starred,
              sender.email AS sender_email,
              sender.display_name AS sender_display_name,
              recipient.email AS recipient_email
            FROM communication.mailbox_entries mb
            INNER JOIN communication.messages m ON m.id = mb.message_id
            INNER JOIN {} sender ON sender.id = m.sender_user_id
            LEFT JOIN {} recipient ON recipient.id = m.recipient_user_id
            WHERE mb.user_id = $1
            AND (
              ($2::text = 'starred' AND mb.starred = TRUE AND mb.folder <> 'trash')
              OR ($2::text <> 'starred' AND mb.folder = $2::text)
            )
            AND (
              m.subject ILIKE $3 OR m.body ILIKE $3 OR sender.email ILIKE $3
              OR COALESCE(recipient.email, '') ILIKE $3
            )
            ORDER BY m.created_at DESC
            "#,
            schema::USERS,
            schema::USERS
        ))
        .bind(user_id)
        .bind(folder)
        .bind(&s)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, ListRow>(&format!(
            r#"
            SELECT
              m.id AS message_id,
              m.sender_user_id,
              m.recipient_user_id,
              m.subject,
              m.body,
              m.snippet,
              m.has_attachment,
              m.created_at,
              mb.folder,
              mb.read_at,
              mb.starred,
              sender.email AS sender_email,
              sender.display_name AS sender_display_name,
              recipient.email AS recipient_email
            FROM communication.mailbox_entries mb
            INNER JOIN communication.messages m ON m.id = mb.message_id
            INNER JOIN {} sender ON sender.id = m.sender_user_id
            LEFT JOIN {} recipient ON recipient.id = m.recipient_user_id
            WHERE mb.user_id = $1
            AND (
              ($2::text = 'starred' AND mb.starred = TRUE AND mb.folder <> 'trash')
              OR ($2::text <> 'starred' AND mb.folder = $2::text)
            )
            ORDER BY m.created_at DESC
            "#,
            schema::USERS,
            schema::USERS
        ))
        .bind(user_id)
        .bind(folder)
        .fetch_all(pool)
        .await?
    };

    Ok(rows.into_iter().map(row_to_public).collect())
}

pub async fn get_for_user(
    pool: &PgPool,
    user_id: Uuid,
    message_id: Uuid,
) -> Result<Option<MailboxMessage>, sqlx::Error> {
    let row = sqlx::query_as::<_, ListRow>(&format!(
        r#"
        SELECT
          m.id AS message_id,
          m.sender_user_id,
          m.recipient_user_id,
          m.subject,
          m.body,
          m.snippet,
          m.has_attachment,
          m.created_at,
          mb.folder,
          mb.read_at,
          mb.starred,
          sender.email AS sender_email,
          sender.display_name AS sender_display_name,
          recipient.email AS recipient_email
        FROM communication.mailbox_entries mb
        INNER JOIN communication.messages m ON m.id = mb.message_id
        INNER JOIN {} sender ON sender.id = m.sender_user_id
        LEFT JOIN {} recipient ON recipient.id = m.recipient_user_id
        WHERE mb.user_id = $1 AND m.id = $2
        "#,
        schema::USERS,
        schema::USERS
    ))
    .bind(user_id)
    .bind(message_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(row_to_public))
}

pub async fn count_unread_inbox(pool: &PgPool, user_id: Uuid) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::bigint
        FROM communication.mailbox_entries mb
        WHERE mb.user_id = $1
          AND mb.folder = 'inbox'
          AND mb.read_at IS NULL
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

/// Returns `None` when no user exists for `to_email`.
pub async fn send_message(
    pool: &PgPool,
    sender_id: Uuid,
    to_email: &str,
    subject: &str,
    body: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    let Some(recipient) = user::find_by_email(pool, to_email).await? else {
        return Ok(None);
    };
    let recipient_id = recipient.id;
    let snippet = make_snippet(body);

    let mut tx = pool.begin().await?;

    let message_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO communication.messages
          (sender_user_id, recipient_user_id, subject, body, snippet, has_attachment)
        VALUES ($1, $2, $3, $4, $5, FALSE)
        RETURNING id
        "#,
    )
    .bind(sender_id)
    .bind(recipient_id)
    .bind(subject)
    .bind(body)
    .bind(&snippet)
    .fetch_one(&mut *tx)
    .await?;

    if sender_id == recipient_id {
        // One mailbox row per (user, message): use inbox + unread so the message appears in
        // Inbox (and realtime refetches) when messaging yourself. A "sent"-only row would
        // never show on the default Inbox tab.
        sqlx::query(
            r#"
            INSERT INTO communication.mailbox_entries
              (user_id, message_id, folder, read_at, starred)
            VALUES ($1, $2, 'inbox', NULL, FALSE)
            "#,
        )
        .bind(sender_id)
        .bind(message_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            r#"
            INSERT INTO communication.mailbox_entries
              (user_id, message_id, folder, read_at, starred)
            VALUES ($1, $2, 'sent', NOW(), FALSE)
            "#,
        )
        .bind(sender_id)
        .bind(message_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO communication.mailbox_entries
              (user_id, message_id, folder, read_at, starred)
            VALUES ($1, $2, 'inbox', NULL, FALSE)
            "#,
        )
        .bind(recipient_id)
        .bind(message_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Some(message_id))
}

pub async fn save_draft(
    pool: &PgPool,
    sender_id: Uuid,
    subject: &str,
    body: &str,
) -> Result<Uuid, sqlx::Error> {
    let snippet = make_snippet(body);
    let mut tx = pool.begin().await?;

    let message_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO communication.messages
          (sender_user_id, recipient_user_id, subject, body, snippet, has_attachment)
        VALUES ($1, NULL, $2, $3, $4, FALSE)
        RETURNING id
        "#,
    )
    .bind(sender_id)
    .bind(subject)
    .bind(body)
    .bind(&snippet)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO communication.mailbox_entries
          (user_id, message_id, folder, read_at, starred)
        VALUES ($1, $2, 'drafts', NOW(), FALSE)
        "#,
    )
    .bind(sender_id)
    .bind(message_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(message_id)
}

pub async fn update_mailbox(
    pool: &PgPool,
    user_id: Uuid,
    message_id: Uuid,
    req: &PatchMailboxRequest,
) -> Result<bool, sqlx::Error> {
    let exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM communication.mailbox_entries WHERE user_id = $1 AND message_id = $2",
    )
    .bind(user_id)
    .bind(message_id)
    .fetch_optional(pool)
    .await?;

    if exists.is_none() {
        return Ok(false);
    }

    if let Some(read) = req.read {
        if read {
            sqlx::query(
                r#"
                UPDATE communication.mailbox_entries
                SET read_at = NOW()
                WHERE user_id = $1 AND message_id = $2 AND read_at IS NULL
                "#,
            )
            .bind(user_id)
            .bind(message_id)
            .execute(pool)
            .await?;
        } else {
            sqlx::query(
                r#"
                UPDATE communication.mailbox_entries
                SET read_at = NULL
                WHERE user_id = $1 AND message_id = $2
                "#,
            )
            .bind(user_id)
            .bind(message_id)
            .execute(pool)
            .await?;
        }
    }

    if let Some(starred) = req.starred {
        sqlx::query(
            r#"
            UPDATE communication.mailbox_entries
            SET starred = $3
            WHERE user_id = $1 AND message_id = $2
            "#,
        )
        .bind(user_id)
        .bind(message_id)
        .bind(starred)
        .execute(pool)
        .await?;
    }

    if let Some(ref folder) = req.folder {
        if !matches!(folder.as_str(), "inbox" | "sent" | "drafts" | "trash") {
            return Ok(false);
        }
        sqlx::query(
            r#"
            UPDATE communication.mailbox_entries
            SET folder = $3
            WHERE user_id = $1 AND message_id = $2
            "#,
        )
        .bind(user_id)
        .bind(message_id)
        .bind(folder)
        .execute(pool)
        .await?;
    }

    Ok(true)
}
