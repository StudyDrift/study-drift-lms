use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, sqlx::FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub display_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub avatar_url: Option<String>,
    pub ui_theme: String,
    pub sid: Option<String>,
}

pub async fn find_by_email(pool: &PgPool, email: &str) -> Result<Option<UserRow>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(&format!(
        "SELECT id, email, password_hash, display_name, first_name, last_name, avatar_url, ui_theme, sid FROM {} WHERE email = $1",
        schema::USERS
    ))
    .bind(email)
    .fetch_optional(pool)
    .await
}

/// Case-insensitive email match (for roster import when upstream stores mixed casing).
pub async fn find_by_email_ci(pool: &PgPool, email: &str) -> Result<Option<UserRow>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(&format!(
        r#"
        SELECT id, email, password_hash, display_name, first_name, last_name, avatar_url, ui_theme, sid
        FROM {}
        WHERE lower(trim(email)) = lower(trim($1))
        "#,
        schema::USERS
    ))
    .bind(email)
    .fetch_optional(pool)
    .await
}

/// Looks up by case-insensitive email; if missing, inserts a new user. On unique race, returns the existing row.
pub async fn find_or_create_user_for_import(
    pool: &PgPool,
    email: &str,
    display_name: Option<&str>,
    placeholder_password_hash: &str,
) -> Result<(UserRow, bool), sqlx::Error> {
    if let Some(row) = find_by_email_ci(pool, email).await? {
        return Ok((row, false));
    }
    let disp = display_name
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match insert_user(pool, email, placeholder_password_hash, disp).await {
        Ok(row) => Ok((row, true)),
        Err(e) => {
            if let sqlx::Error::Database(ref db) = e {
                if db.code().as_deref() == Some("23505") {
                    if let Some(row) = find_by_email_ci(pool, email).await? {
                        return Ok((row, false));
                    }
                }
            }
            Err(e)
        }
    }
}

pub async fn insert_user(
    pool: &PgPool,
    email: &str,
    password_hash: &str,
    display_name: Option<&str>,
) -> Result<UserRow, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(&format!(
        r#"
        INSERT INTO {} (email, password_hash, display_name)
        VALUES ($1, $2, $3)
        RETURNING id, email, password_hash, display_name, first_name, last_name, avatar_url, ui_theme, sid
        "#,
        schema::USERS
    ))
    .bind(email)
    .bind(password_hash)
    .bind(display_name)
    .fetch_one(pool)
    .await
}

#[derive(Debug, sqlx::FromRow)]
pub struct UserProfileRow {
    pub email: String,
    pub display_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub avatar_url: Option<String>,
    pub ui_theme: String,
    pub sid: Option<String>,
}

pub async fn get_profile_by_id(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<UserProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, UserProfileRow>(&format!(
        r#"
        SELECT email, display_name, first_name, last_name, avatar_url, ui_theme, sid
        FROM {}
        WHERE id = $1
        "#,
        schema::USERS
    ))
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

fn derive_display_name(first_name: Option<&str>, last_name: Option<&str>) -> Option<String> {
    let first = first_name.unwrap_or("").trim();
    let last = last_name.unwrap_or("").trim();
    let combined = if first.is_empty() && last.is_empty() {
        String::new()
    } else if first.is_empty() {
        last.to_string()
    } else if last.is_empty() {
        first.to_string()
    } else {
        format!("{first} {last}")
    };
    if combined.is_empty() {
        None
    } else {
        Some(combined)
    }
}

pub async fn update_profile(
    pool: &PgPool,
    user_id: Uuid,
    first_name: Option<&str>,
    last_name: Option<&str>,
    avatar_url: Option<&str>,
    ui_theme: Option<&str>,
) -> Result<Option<UserProfileRow>, sqlx::Error> {
    let display_name = derive_display_name(first_name, last_name);
    sqlx::query_as::<_, UserProfileRow>(&format!(
        r#"
        UPDATE {}
        SET
            first_name = $2,
            last_name = $3,
            avatar_url = $4,
            display_name = $5,
            ui_theme = COALESCE($6, ui_theme)
        WHERE id = $1
        RETURNING email, display_name, first_name, last_name, avatar_url, ui_theme, sid
        "#,
        schema::USERS
    ))
    .bind(user_id)
    .bind(first_name)
    .bind(last_name)
    .bind(avatar_url)
    .bind(display_name)
    .bind(ui_theme)
    .fetch_optional(pool)
    .await
}

/// Sets or clears the campus student identifier (`sid`). Intended for administrator use only.
pub async fn set_user_sid(
    pool: &PgPool,
    user_id: Uuid,
    sid: Option<&str>,
) -> Result<u64, sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"UPDATE {} SET sid = $2 WHERE id = $1"#,
        schema::USERS
    ))
    .bind(user_id)
    .bind(sid)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n)
}

/// Row for accessibility-coordinator user lookup (email, names, `sid`, or exact id).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserAccommodationSearchRow {
    pub id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub sid: Option<String>,
}

/// Search learners by email, display name, first or last name, campus `sid`, or exact UUID.
pub async fn search_users_for_accommodation_lookup(
    pool: &PgPool,
    query: &str,
) -> Result<Vec<UserAccommodationSearchRow>, sqlx::Error> {
    let t = query.trim();
    if t.is_empty() {
        return Ok(Vec::new());
    }

    if let Ok(id) = Uuid::parse_str(t) {
        let row = sqlx::query_as::<_, UserAccommodationSearchRow>(&format!(
            r#"
            SELECT id, email, display_name, first_name, last_name, sid
            FROM {}
            WHERE id = $1
            "#,
            schema::USERS
        ))
        .bind(id)
        .fetch_optional(pool)
        .await?;
        return Ok(row.map(|r| vec![r]).unwrap_or_default());
    }

    if t.len() < 2 {
        return Ok(Vec::new());
    }

    let pattern = format!("%{t}%");
    sqlx::query_as::<_, UserAccommodationSearchRow>(&format!(
        r#"
        SELECT id, email, display_name, first_name, last_name, sid
        FROM {}
        WHERE email ILIKE $1
           OR COALESCE(display_name, '') ILIKE $1
           OR COALESCE(first_name, '') ILIKE $1
           OR COALESCE(last_name, '') ILIKE $1
           OR COALESCE(sid, '') ILIKE $1
        ORDER BY LOWER(email) ASC
        LIMIT 40
        "#,
        schema::USERS
    ))
    .bind(&pattern)
    .fetch_all(pool)
    .await
}
