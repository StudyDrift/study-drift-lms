use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_feed::{
    FeedChannelPublic, FeedMessagePublic, FeedRosterPerson,
};

const DEFAULT_CHANNEL_NAME: &str = "general";

pub async fn channel_belongs_to_course(
    pool: &PgPool,
    course_id: Uuid,
    channel_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM {} ch WHERE ch.id = $1 AND ch.course_id = $2
        )
        "#,
        schema::FEED_CHANNELS
    ))
    .bind(channel_id)
    .bind(course_id)
    .fetch_one(pool)
    .await
}

pub async fn message_meta(
    pool: &PgPool,
    course_id: Uuid,
    message_id: Uuid,
) -> Result<Option<(Uuid, Uuid, Uuid)>, sqlx::Error> {
    // (channel_id, author_user_id, course_id) — course_id echoed for caller convenience
    let row = sqlx::query_as::<_, (Uuid, Uuid)>(&format!(
        r#"
        SELECT m.channel_id, m.author_user_id
        FROM {} m
        INNER JOIN {} ch ON ch.id = m.channel_id
        WHERE m.id = $1 AND ch.course_id = $2
        "#,
        schema::FEED_MESSAGES,
        schema::FEED_CHANNELS
    ))
    .bind(message_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(ch, author)| (ch, author, course_id)))
}

async fn ensure_default_channel(
    pool: &PgPool,
    course_id: Uuid,
    created_by: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, name, sort_order, created_by_user_id)
        SELECT $1, $2, 0, $3
        WHERE NOT EXISTS (SELECT 1 FROM {} WHERE course_id = $1)
        "#,
        schema::FEED_CHANNELS,
        schema::FEED_CHANNELS
    ))
    .bind(course_id)
    .bind(DEFAULT_CHANNEL_NAME)
    .bind(created_by)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_channels(
    pool: &PgPool,
    course_id: Uuid,
    viewer_id: Uuid,
) -> Result<Vec<FeedChannelPublic>, sqlx::Error> {
    ensure_default_channel(pool, course_id, viewer_id).await?;
    let rows = sqlx::query_as::<_, FeedChannelPublic>(&format!(
        r#"
        SELECT id, name, sort_order, created_at
        FROM {}
        WHERE course_id = $1
        ORDER BY sort_order ASC, created_at ASC
        "#,
        schema::FEED_CHANNELS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn create_channel(
    pool: &PgPool,
    course_id: Uuid,
    viewer_id: Uuid,
    name: &str,
) -> Result<FeedChannelPublic, sqlx::Error> {
    ensure_default_channel(pool, course_id, viewer_id).await?;
    let max_sort: Option<i32> = sqlx::query_scalar(&format!(
        r#"SELECT MAX(sort_order) FROM {} WHERE course_id = $1"#,
        schema::FEED_CHANNELS
    ))
    .bind(course_id)
    .fetch_one(pool)
    .await?;
    let next = max_sort.unwrap_or(0) + 1;
    let row = sqlx::query_as::<_, FeedChannelPublic>(&format!(
        r#"
        INSERT INTO {} (course_id, name, sort_order, created_by_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, sort_order, created_at
        "#,
        schema::FEED_CHANNELS
    ))
    .bind(course_id)
    .bind(name)
    .bind(next)
    .bind(viewer_id)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn list_roster(pool: &PgPool, course_id: Uuid) -> Result<Vec<FeedRosterPerson>, sqlx::Error> {
    sqlx::query_as::<_, FeedRosterPerson>(&format!(
        r#"
        SELECT u.id AS user_id, u.email, u.display_name
        FROM {} ce
        INNER JOIN {} u ON u.id = ce.user_id
        WHERE ce.course_id = $1
        ORDER BY lower(COALESCE(u.display_name, u.email)) ASC
        "#,
        schema::COURSE_ENROLLMENTS,
        schema::USERS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn enrolled_user_ids(pool: &PgPool, course_id: Uuid) -> Result<HashSet<Uuid>, sqlx::Error> {
    let ids: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"SELECT user_id FROM {} WHERE course_id = $1"#,
        schema::COURSE_ENROLLMENTS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await?;
    Ok(ids.into_iter().collect())
}

#[derive(sqlx::FromRow)]
struct MsgSql {
    id: Uuid,
    channel_id: Uuid,
    author_user_id: Uuid,
    author_email: String,
    author_display_name: Option<String>,
    parent_message_id: Option<Uuid>,
    body: String,
    mentions_everyone: bool,
    pinned_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    edited_at: Option<DateTime<Utc>>,
}

fn empty_public(m: MsgSql) -> FeedMessagePublic {
    FeedMessagePublic {
        id: m.id,
        channel_id: m.channel_id,
        author_user_id: m.author_user_id,
        author_email: m.author_email,
        author_display_name: m.author_display_name,
        parent_message_id: m.parent_message_id,
        body: m.body,
        mentions_everyone: m.mentions_everyone,
        mention_user_ids: vec![],
        pinned_at: m.pinned_at,
        created_at: m.created_at,
        edited_at: m.edited_at,
        like_count: 0,
        viewer_has_liked: false,
        replies: vec![],
    }
}

async fn load_mention_map(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<Uuid>>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(&format!(
        r#"
        SELECT message_id, mentioned_user_id
        FROM {}
        WHERE message_id = ANY($1)
        "#,
        schema::FEED_MESSAGE_MENTIONS
    ))
    .bind(message_ids)
    .fetch_all(pool)
    .await?;
    let mut m: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (mid, uid) in rows {
        m.entry(mid).or_default().push(uid);
    }
    Ok(m)
}

async fn load_like_stats(
    pool: &PgPool,
    message_ids: &[Uuid],
    viewer_id: Uuid,
) -> Result<(HashMap<Uuid, i64>, HashSet<Uuid>), sqlx::Error> {
    if message_ids.is_empty() {
        return Ok((HashMap::new(), HashSet::new()));
    }
    let counts: Vec<(Uuid, i64)> = sqlx::query_as(&format!(
        r#"
        SELECT message_id, COUNT(*)::bigint
        FROM {}
        WHERE message_id = ANY($1)
        GROUP BY message_id
        "#,
        schema::FEED_MESSAGE_LIKES
    ))
    .bind(message_ids)
    .fetch_all(pool)
    .await?;
    let liked: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"SELECT message_id FROM {} WHERE message_id = ANY($1) AND user_id = $2"#,
        schema::FEED_MESSAGE_LIKES
    ))
    .bind(message_ids)
    .bind(viewer_id)
    .fetch_all(pool)
    .await?;
    let mut count_map = HashMap::new();
    for (mid, c) in counts {
        count_map.insert(mid, c);
    }
    let liked_set: HashSet<Uuid> = liked.into_iter().collect();
    Ok((count_map, liked_set))
}

fn decorate(
    m: MsgSql,
    mentions: &HashMap<Uuid, Vec<Uuid>>,
    like_counts: &HashMap<Uuid, i64>,
    viewer_likes: &HashSet<Uuid>,
) -> FeedMessagePublic {
    let mut p = empty_public(m);
    p.mention_user_ids = mentions.get(&p.id).cloned().unwrap_or_default();
    p.like_count = *like_counts.get(&p.id).unwrap_or(&0);
    p.viewer_has_liked = viewer_likes.contains(&p.id);
    p
}

pub async fn list_messages_threaded(
    pool: &PgPool,
    channel_id: Uuid,
    viewer_id: Uuid,
    limit_roots: i64,
) -> Result<Vec<FeedMessagePublic>, sqlx::Error> {
    let roots: Vec<MsgSql> = sqlx::query_as(&format!(
        r#"
        SELECT
            m.id,
            m.channel_id,
            m.author_user_id,
            u.email AS author_email,
            u.display_name AS author_display_name,
            m.parent_message_id,
            m.body,
            m.mentions_everyone,
            m.pinned_at,
            m.created_at,
            m.edited_at
        FROM {} m
        INNER JOIN {} u ON u.id = m.author_user_id
        WHERE m.channel_id = $1 AND m.parent_message_id IS NULL
        ORDER BY
            (m.pinned_at IS NOT NULL) DESC,
            m.pinned_at DESC NULLS LAST,
            m.created_at ASC
        LIMIT $2
        "#,
        schema::FEED_MESSAGES,
        schema::USERS
    ))
    .bind(channel_id)
    .bind(limit_roots)
    .fetch_all(pool)
    .await?;

    if roots.is_empty() {
        return Ok(vec![]);
    }

    let root_ids: Vec<Uuid> = roots.iter().map(|r| r.id).collect();
    let replies: Vec<MsgSql> = sqlx::query_as(&format!(
        r#"
        SELECT
            m.id,
            m.channel_id,
            m.author_user_id,
            u.email AS author_email,
            u.display_name AS author_display_name,
            m.parent_message_id,
            m.body,
            m.mentions_everyone,
            m.pinned_at,
            m.created_at,
            m.edited_at
        FROM {} m
        INNER JOIN {} u ON u.id = m.author_user_id
        WHERE m.parent_message_id = ANY($1)
        ORDER BY m.created_at ASC
        "#,
        schema::FEED_MESSAGES,
        schema::USERS
    ))
    .bind(&root_ids)
    .fetch_all(pool)
    .await?;

    let mut all_ids: Vec<Uuid> = roots.iter().map(|r| r.id).chain(replies.iter().map(|r| r.id)).collect();
    all_ids.sort_unstable();
    all_ids.dedup();

    let mention_map = load_mention_map(pool, &all_ids).await?;
    let (like_counts, viewer_likes) = load_like_stats(pool, &all_ids, viewer_id).await?;

    let mut out: Vec<FeedMessagePublic> = roots
        .into_iter()
        .map(|m| decorate(m, &mention_map, &like_counts, &viewer_likes))
        .collect();

    let mut by_parent: HashMap<Uuid, Vec<FeedMessagePublic>> = HashMap::new();
    for m in replies {
        let p = decorate(m, &mention_map, &like_counts, &viewer_likes);
        if let Some(pid) = p.parent_message_id {
            by_parent.entry(pid).or_default().push(p);
        }
    }

    for root in &mut out {
        root.replies = by_parent.remove(&root.id).unwrap_or_default();
    }

    Ok(out)
}

pub async fn parent_is_root_in_channel(
    pool: &PgPool,
    channel_id: Uuid,
    parent_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM {}
            WHERE id = $1 AND channel_id = $2 AND parent_message_id IS NULL
        )
        "#,
        schema::FEED_MESSAGES
    ))
    .bind(parent_id)
    .bind(channel_id)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

pub async fn create_message(
    pool: &PgPool,
    channel_id: Uuid,
    author_id: Uuid,
    body: &str,
    parent_message_id: Option<Uuid>,
    mention_user_ids: &[Uuid],
    mentions_everyone: bool,
) -> Result<Uuid, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (
            channel_id, author_user_id, parent_message_id, body, mentions_everyone
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
        schema::FEED_MESSAGES
    ))
    .bind(channel_id)
    .bind(author_id)
    .bind(parent_message_id)
    .bind(body)
    .bind(mentions_everyone)
    .fetch_one(&mut *tx)
    .await?;

    for uid in mention_user_ids {
        sqlx::query(&format!(
            r#"
            INSERT INTO {} (message_id, mentioned_user_id)
            VALUES ($1, $2)
            ON CONFLICT (message_id, mentioned_user_id) DO NOTHING
            "#,
            schema::FEED_MESSAGE_MENTIONS
        ))
        .bind(id)
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(id)
}

pub async fn update_message_body(
    pool: &PgPool,
    message_id: Uuid,
    author_id: Uuid,
    body: &str,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET body = $1, edited_at = NOW()
        WHERE id = $2 AND author_user_id = $3
        "#,
        schema::FEED_MESSAGES
    ))
    .bind(body)
    .bind(message_id)
    .bind(author_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn set_pinned(
    pool: &PgPool,
    course_id: Uuid,
    message_id: Uuid,
    pinned: bool,
    moderator_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = if pinned {
        sqlx::query(&format!(
            r#"
            UPDATE {} m
            SET pinned_at = NOW(), pinned_by_user_id = $1
            FROM {} ch
            WHERE m.id = $2 AND m.channel_id = ch.id AND ch.course_id = $3
              AND m.parent_message_id IS NULL
            "#,
            schema::FEED_MESSAGES,
            schema::FEED_CHANNELS
        ))
        .bind(moderator_id)
        .bind(message_id)
        .bind(course_id)
        .execute(pool)
        .await?
    } else {
        sqlx::query(&format!(
            r#"
            UPDATE {} m
            SET pinned_at = NULL, pinned_by_user_id = NULL
            FROM {} ch
            WHERE m.id = $1 AND m.channel_id = ch.id AND ch.course_id = $2
            "#,
            schema::FEED_MESSAGES,
            schema::FEED_CHANNELS
        ))
        .bind(message_id)
        .bind(course_id)
        .execute(pool)
        .await?
    };
    Ok(r.rows_affected() > 0)
}

pub async fn add_like(pool: &PgPool, message_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (message_id, user_id) VALUES ($1, $2)
        ON CONFLICT (message_id, user_id) DO NOTHING
        "#,
        schema::FEED_MESSAGE_LIKES
    ))
    .bind(message_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_like(pool: &PgPool, message_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE message_id = $1 AND user_id = $2"#,
        schema::FEED_MESSAGE_LIKES
    ))
    .bind(message_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

