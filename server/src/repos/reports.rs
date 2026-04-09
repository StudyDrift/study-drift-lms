use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;
use crate::models::reports::{
    CourseActivityRow, DayActivityBucket, EventKindCount, LearningActivitySummary,
};

#[derive(sqlx::FromRow)]
struct SummaryRow {
    total_events: i64,
    unique_users: i64,
    unique_courses: i64,
}

pub async fn learning_activity_summary(
    pool: &PgPool,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<LearningActivitySummary, sqlx::Error> {
    let row = sqlx::query_as::<_, SummaryRow>(&format!(
        r#"
        SELECT
            COUNT(*)::bigint AS total_events,
            COUNT(DISTINCT user_id)::bigint AS unique_users,
            COUNT(DISTINCT course_id)::bigint AS unique_courses
        FROM {}
        WHERE occurred_at >= $1 AND occurred_at < $2
        "#,
        schema::USER_AUDIT
    ))
    .bind(from)
    .bind(to)
    .fetch_one(pool)
    .await?;
    Ok(LearningActivitySummary {
        total_events: row.total_events,
        unique_users: row.unique_users,
        unique_courses: row.unique_courses,
    })
}

pub async fn learning_activity_by_day(
    pool: &PgPool,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<DayActivityBucket>, sqlx::Error> {
    let rows = sqlx::query_as::<_, DayActivityBucket>(&format!(
        r#"
        SELECT
            (date_trunc('day', occurred_at AT TIME ZONE 'UTC'))::date AS day,
            COUNT(*) FILTER (WHERE event_kind = 'course_visit')::bigint AS course_visit,
            COUNT(*) FILTER (WHERE event_kind = 'content_open')::bigint AS content_open,
            COUNT(*) FILTER (WHERE event_kind = 'content_leave')::bigint AS content_leave
        FROM {}
        WHERE occurred_at >= $1 AND occurred_at < $2
        GROUP BY 1
        ORDER BY 1 ASC
        "#,
        schema::USER_AUDIT
    ))
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(sqlx::FromRow)]
struct KindRow {
    event_kind: String,
    count: i64,
}

pub async fn learning_activity_by_event_kind(
    pool: &PgPool,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<EventKindCount>, sqlx::Error> {
    let rows = sqlx::query_as::<_, KindRow>(&format!(
        r#"
        SELECT event_kind, COUNT(*)::bigint AS count
        FROM {}
        WHERE occurred_at >= $1 AND occurred_at < $2
        GROUP BY event_kind
        ORDER BY count DESC
        "#,
        schema::USER_AUDIT
    ))
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| EventKindCount {
            event_kind: r.event_kind,
            count: r.count,
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct TopCourseRow {
    course_id: Uuid,
    course_code: String,
    title: String,
    event_count: i64,
}

pub async fn learning_activity_top_courses(
    pool: &PgPool,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<CourseActivityRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, TopCourseRow>(&format!(
        r#"
        SELECT c.id AS course_id, c.course_code, c.title, COUNT(*)::bigint AS event_count
        FROM {} ua
        INNER JOIN {} c ON c.id = ua.course_id
        WHERE ua.occurred_at >= $1 AND ua.occurred_at < $2
        GROUP BY c.id, c.course_code, c.title
        ORDER BY event_count DESC
        LIMIT $3
        "#,
        schema::USER_AUDIT,
        schema::COURSES
    ))
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| CourseActivityRow {
            course_id: r.course_id,
            course_code: r.course_code,
            title: r.title,
            event_count: r.event_count,
        })
        .collect())
}
