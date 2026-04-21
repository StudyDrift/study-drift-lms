//! Learner mastery (`course.learner_concept_states`, `course.learner_concept_events`).

use chrono::{DateTime, Utc};
use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LearnerConceptStateRow {
    pub concept_id: Uuid,
    pub concept_name: String,
    pub stored_mastery: f64,
    pub mastery_effective: f64,
    pub attempt_count: i32,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub needs_review_at: Option<DateTime<Utc>>,
}

/// List concept states for a learner with decayed mastery for API reads.
/// Concepts in a course limited (for adaptive prompt size).
pub async fn list_states_for_user_and_course(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Uuid,
    limit: i64,
) -> Result<Vec<LearnerConceptStateRow>, sqlx::Error> {
    sqlx::query_as::<_, LearnerConceptStateRow>(&format!(
        r#"
        SELECT
            c.id AS concept_id,
            c.name AS concept_name,
            (s.mastery)::float8 AS stored_mastery,
            (
                CASE
                    WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
                    ELSE LEAST(1.0, GREATEST(0.0,
                        (s.mastery)::float8 * exp(
                            -(c.decay_lambda)::float8
                            * (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
                        )
                    ))
                END
            ) AS mastery_effective,
            s.attempt_count,
            s.last_seen_at,
            s.needs_review_at
        FROM {} s
        INNER JOIN {} c ON c.id = s.concept_id
        WHERE s.user_id = $1
          AND (
            c.course_id = $2
            OR EXISTS (
                SELECT 1
                FROM course.concept_question_tags t
                INNER JOIN course.questions q ON q.id = t.question_id
                WHERE t.concept_id = c.id AND q.course_id = $2
            )
          )
        ORDER BY c.name ASC
        LIMIT $3
        "#,
        schema::LEARNER_CONCEPT_STATES,
        schema::CONCEPTS
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn list_states_for_user(
    pool: &PgPool,
    user_id: Uuid,
    concept_ids: Option<&[Uuid]>,
) -> Result<Vec<LearnerConceptStateRow>, sqlx::Error> {
    let rows: Vec<LearnerConceptStateRow> = if let Some(ids) = concept_ids.filter(|x| !x.is_empty())
    {
        sqlx::query_as::<_, LearnerConceptStateRow>(&format!(
            r#"
            SELECT
                c.id AS concept_id,
                c.name AS concept_name,
                (s.mastery)::float8 AS stored_mastery,
                (
                    CASE
                        WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
                        ELSE LEAST(1.0, GREATEST(0.0,
                            (s.mastery)::float8 * exp(
                                -(c.decay_lambda)::float8
                                * (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
                            )
                        ))
                    END
                ) AS mastery_effective,
                s.attempt_count,
                s.last_seen_at,
                s.needs_review_at
            FROM {} s
            INNER JOIN {} c ON c.id = s.concept_id
            WHERE s.user_id = $1 AND s.concept_id = ANY($2)
            ORDER BY c.name ASC
            "#,
            schema::LEARNER_CONCEPT_STATES,
            schema::CONCEPTS
        ))
        .bind(user_id)
        .bind(ids)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, LearnerConceptStateRow>(&format!(
            r#"
            SELECT
                c.id AS concept_id,
                c.name AS concept_name,
                (s.mastery)::float8 AS stored_mastery,
                (
                    CASE
                        WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
                        ELSE LEAST(1.0, GREATEST(0.0,
                            (s.mastery)::float8 * exp(
                                -(c.decay_lambda)::float8
                                * (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
                            )
                        ))
                    END
                ) AS mastery_effective,
                s.attempt_count,
                s.last_seen_at,
                s.needs_review_at
            FROM {} s
            INNER JOIN {} c ON c.id = s.concept_id
            WHERE s.user_id = $1
            ORDER BY c.name ASC
            "#,
            schema::LEARNER_CONCEPT_STATES,
            schema::CONCEPTS
        ))
        .bind(user_id)
        .fetch_all(pool)
        .await?
    };
    Ok(rows)
}

/// Single concept lookup for one learner.
pub async fn get_state_for_user_concept(
    pool: &PgPool,
    user_id: Uuid,
    concept_id: Uuid,
) -> Result<Option<LearnerConceptStateRow>, sqlx::Error> {
    sqlx::query_as::<_, LearnerConceptStateRow>(&format!(
        r#"
        SELECT
            c.id AS concept_id,
            c.name AS concept_name,
            (s.mastery)::float8 AS stored_mastery,
            (
                CASE
                    WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
                    ELSE LEAST(1.0, GREATEST(0.0,
                        (s.mastery)::float8 * exp(
                            -(c.decay_lambda)::float8
                            * (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
                        )
                    ))
                END
            ) AS mastery_effective,
            s.attempt_count,
            s.last_seen_at,
            s.needs_review_at
        FROM {} s
        INNER JOIN {} c ON c.id = s.concept_id
        WHERE s.user_id = $1 AND s.concept_id = $2
        "#,
        schema::LEARNER_CONCEPT_STATES,
        schema::CONCEPTS
    ))
    .bind(user_id)
    .bind(concept_id)
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Clone)]
pub struct LearnerModelUpdateInput {
    pub user_id: Uuid,
    pub attempt_id: Uuid,
    pub course_id: Uuid,
    pub concept_id: Uuid,
    /// Per-question score in [0, 1].
    pub score: f64,
    pub question_index: i32,
    pub ema_alpha: f64,
    /// Multiplier on `ema_alpha` when a known misconception was triggered (default 1.0).
    pub ema_alpha_multiplier: f64,
}

pub fn effective_mastery_engine(
    stored: f64,
    last_seen_at: Option<DateTime<Utc>>,
    decay_lambda: f64,
) -> f64 {
    let Some(ts) = last_seen_at else {
        return stored.clamp(0.0, 1.0);
    };
    let days = (Utc::now() - ts).num_seconds() as f64 / 86400.0;
    if days <= 0.0 {
        return stored.clamp(0.0, 1.0);
    }
    (stored * (-decay_lambda * days).exp()).clamp(0.0, 1.0)
}

/// Apply one mastery update inside the quiz grading transaction.
pub async fn apply_mastery_update_in_tx<'e, E>(
    executor: &mut E,
    input: &LearnerModelUpdateInput,
) -> Result<(), sqlx::Error>
where
    for<'a> &'a mut E: Executor<'a, Database = Postgres>,
{
    let idempotency_key = format!(
        "quiz_grade:{}:{}:{}",
        input.attempt_id, input.concept_id, input.question_index
    );

    let decay_row: Option<(f64,)> = sqlx::query_as(&format!(
        r#"
        SELECT (c.decay_lambda)::float8
        FROM {} c
        WHERE c.id = $1
        FOR UPDATE
        "#,
        schema::CONCEPTS
    ))
    .bind(input.concept_id)
    .fetch_optional(&mut *executor)
    .await?;

    let Some((decay_lambda,)) = decay_row else {
        return Ok(());
    };

    let state_row: Option<(f64, Option<DateTime<Utc>>)> = sqlx::query_as(&format!(
        r#"
        SELECT COALESCE((mastery)::float8, 0.0), last_seen_at
        FROM {}
        WHERE user_id = $1 AND concept_id = $2
        FOR UPDATE
        "#,
        schema::LEARNER_CONCEPT_STATES
    ))
    .bind(input.user_id)
    .bind(input.concept_id)
    .fetch_optional(&mut *executor)
    .await?;

    let (stored_mastery, last_seen_at) = state_row.unwrap_or((0.0, None));

    let m_old_eff = effective_mastery_engine(stored_mastery, last_seen_at, decay_lambda);
    let score = input.score.clamp(0.0, 1.0);
    let alpha = (input.ema_alpha * input.ema_alpha_multiplier.clamp(0.01, 2.0)).clamp(0.01, 1.0);
    let m_new = (m_old_eff * (1.0 - alpha) + score * alpha).clamp(0.0, 1.0);
    let delta = m_new - m_old_eff;

    let now = Utc::now();
    let needs_review_at = if m_new < 0.5 {
        now + chrono::Duration::days(3)
    } else if m_new < 0.8 {
        now + chrono::Duration::days(14)
    } else {
        now + chrono::Duration::days(30)
    };

    let event_id: Option<Uuid> = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (
            user_id, concept_id, attempt_id, delta, mastery_after, source, idempotency_key
        )
        VALUES ($1, $2, $3, $4::numeric, $5::numeric, 'quiz_grade', $6)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
        "#,
        schema::LEARNER_CONCEPT_EVENTS
    ))
    .bind(input.user_id)
    .bind(input.concept_id)
    .bind(input.attempt_id)
    .bind(delta)
    .bind(m_new)
    .bind(&idempotency_key)
    .fetch_optional(&mut *executor)
    .await?;

    if event_id.is_none() {
        return Ok(());
    }

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            user_id, concept_id, mastery, attempt_count, last_seen_at, needs_review_at, updated_at
        )
        VALUES ($1, $2, $3::numeric, 1, $4, $5, NOW())
        ON CONFLICT (user_id, concept_id) DO UPDATE SET
            mastery = EXCLUDED.mastery,
            attempt_count = {}.attempt_count + 1,
            last_seen_at = EXCLUDED.last_seen_at,
            needs_review_at = EXCLUDED.needs_review_at,
            updated_at = NOW()
        "#,
        schema::LEARNER_CONCEPT_STATES,
        schema::LEARNER_CONCEPT_STATES,
    ))
    .bind(input.user_id)
    .bind(input.concept_id)
    .bind(m_new)
    .bind(now)
    .bind(needs_review_at)
    .execute(&mut *executor)
    .await?;

    Ok(())
}

#[derive(Debug, Clone)]
pub struct LearnerSrsMasteryInput {
    pub user_id: Uuid,
    pub course_id: Uuid,
    pub concept_id: Uuid,
    pub score: f64,
    pub review_event_id: Uuid,
    pub ema_alpha: f64,
}

/// Mastery bump from SRS review grades (separate idempotency namespace from quiz grading).
pub async fn apply_srs_mastery_update_in_tx<'e, E>(
    executor: &mut E,
    input: &LearnerSrsMasteryInput,
) -> Result<(), sqlx::Error>
where
    for<'a> &'a mut E: Executor<'a, Database = Postgres>,
{
    let idempotency_key = format!("srs_review:{}:{}", input.review_event_id, input.concept_id);

    let decay_row: Option<(f64,)> = sqlx::query_as(&format!(
        r#"
        SELECT (c.decay_lambda)::float8
        FROM {} c
        WHERE c.id = $1
        FOR UPDATE
        "#,
        schema::CONCEPTS
    ))
    .bind(input.concept_id)
    .fetch_optional(&mut *executor)
    .await?;

    let Some((decay_lambda,)) = decay_row else {
        return Ok(());
    };

    let state_row: Option<(f64, Option<DateTime<Utc>>)> = sqlx::query_as(&format!(
        r#"
        SELECT COALESCE((mastery)::float8, 0.0), last_seen_at
        FROM {}
        WHERE user_id = $1 AND concept_id = $2
        FOR UPDATE
        "#,
        schema::LEARNER_CONCEPT_STATES
    ))
    .bind(input.user_id)
    .bind(input.concept_id)
    .fetch_optional(&mut *executor)
    .await?;

    let (stored_mastery, last_seen_at) = state_row.unwrap_or((0.0, None));

    let m_old_eff = effective_mastery_engine(stored_mastery, last_seen_at, decay_lambda);
    let score = input.score.clamp(0.0, 1.0);
    let alpha = input.ema_alpha.clamp(0.01, 1.0);
    let m_new = (m_old_eff * (1.0 - alpha) + score * alpha).clamp(0.0, 1.0);
    let delta = m_new - m_old_eff;

    let now = Utc::now();
    let needs_review_at = if m_new < 0.5 {
        now + chrono::Duration::days(3)
    } else if m_new < 0.8 {
        now + chrono::Duration::days(14)
    } else {
        now + chrono::Duration::days(30)
    };

    let event_id: Option<Uuid> = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (
            user_id, concept_id, attempt_id, delta, mastery_after, source, idempotency_key
        )
        VALUES ($1, $2, NULL, $3::numeric, $4::numeric, 'srs_review', $5)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
        "#,
        schema::LEARNER_CONCEPT_EVENTS
    ))
    .bind(input.user_id)
    .bind(input.concept_id)
    .bind(delta)
    .bind(m_new)
    .bind(&idempotency_key)
    .fetch_optional(&mut *executor)
    .await?;

    if event_id.is_none() {
        return Ok(());
    }

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            user_id, concept_id, mastery, attempt_count, last_seen_at, needs_review_at, updated_at
        )
        VALUES ($1, $2, $3::numeric, 1, $4, $5, NOW())
        ON CONFLICT (user_id, concept_id) DO UPDATE SET
            mastery = EXCLUDED.mastery,
            attempt_count = {}.attempt_count + 1,
            last_seen_at = EXCLUDED.last_seen_at,
            needs_review_at = EXCLUDED.needs_review_at,
            updated_at = NOW()
        "#,
        schema::LEARNER_CONCEPT_STATES,
        schema::LEARNER_CONCEPT_STATES,
    ))
    .bind(input.user_id)
    .bind(input.concept_id)
    .bind(m_new)
    .bind(now)
    .bind(needs_review_at)
    .execute(&mut *executor)
    .await?;

    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct BatchStateRow {
    user_id: Uuid,
    concept_id: Uuid,
    concept_name: String,
    stored_mastery: f64,
    mastery_effective: f64,
    attempt_count: i32,
    last_seen_at: Option<DateTime<Utc>>,
    needs_review_at: Option<DateTime<Utc>>,
}

/// Batch-load states for instructor reporting (many users).
pub async fn batch_list_states_for_users(
    pool: &PgPool,
    user_ids: &[Uuid],
    concept_ids: Option<&[Uuid]>,
    limit_users: usize,
) -> Result<Vec<(Uuid, LearnerConceptStateRow)>, sqlx::Error> {
    if user_ids.is_empty() {
        return Ok(vec![]);
    }
    let n = user_ids.len().min(limit_users);
    let slice = &user_ids[..n];

    let rows: Vec<BatchStateRow> = if let Some(ids) = concept_ids.filter(|x| !x.is_empty()) {
        sqlx::query_as::<_, BatchStateRow>(&format!(
            r#"
            SELECT
                s.user_id,
                c.id AS concept_id,
                c.name AS concept_name,
                (s.mastery)::float8 AS stored_mastery,
                (
                    CASE
                        WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
                        ELSE LEAST(1.0, GREATEST(0.0,
                            (s.mastery)::float8 * exp(
                                -(c.decay_lambda)::float8
                                * (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
                            )
                        ))
                    END
                ) AS mastery_effective,
                s.attempt_count,
                s.last_seen_at,
                s.needs_review_at
            FROM {} s
            INNER JOIN {} c ON c.id = s.concept_id
            WHERE s.user_id = ANY($1) AND s.concept_id = ANY($2)
            ORDER BY s.user_id, c.name ASC
            "#,
            schema::LEARNER_CONCEPT_STATES,
            schema::CONCEPTS
        ))
        .bind(slice)
        .bind(ids)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, BatchStateRow>(&format!(
            r#"
            SELECT
                s.user_id,
                c.id AS concept_id,
                c.name AS concept_name,
                (s.mastery)::float8 AS stored_mastery,
                (
                    CASE
                        WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
                        ELSE LEAST(1.0, GREATEST(0.0,
                            (s.mastery)::float8 * exp(
                                -(c.decay_lambda)::float8
                                * (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
                            )
                        ))
                    END
                ) AS mastery_effective,
                s.attempt_count,
                s.last_seen_at,
                s.needs_review_at
            FROM {} s
            INNER JOIN {} c ON c.id = s.concept_id
            WHERE s.user_id = ANY($1)
            ORDER BY s.user_id, c.name ASC
            "#,
            schema::LEARNER_CONCEPT_STATES,
            schema::CONCEPTS
        ))
        .bind(slice)
        .fetch_all(pool)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.user_id,
                LearnerConceptStateRow {
                    concept_id: r.concept_id,
                    concept_name: r.concept_name,
                    stored_mastery: r.stored_mastery,
                    mastery_effective: r.mastery_effective,
                    attempt_count: r.attempt_count,
                    last_seen_at: r.last_seen_at,
                    needs_review_at: r.needs_review_at,
                },
            )
        })
        .collect())
}

/// Append-only θ log plus upsert of `learner_concept_states.theta` / `theta_se`.
pub async fn record_learner_theta_snapshot(
    pool: &PgPool,
    user_id: Uuid,
    concept_id: Uuid,
    attempt_id: Uuid,
    theta: f64,
    theta_se: Option<f64>,
    items_n: i32,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (user_id, concept_id, attempt_id, theta, theta_se, items_n)
        VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6)
        "#,
        schema::LEARNER_THETA_EVENTS
    ))
    .bind(user_id)
    .bind(concept_id)
    .bind(attempt_id)
    .bind(theta)
    .bind(theta_se)
    .bind(items_n)
    .execute(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            user_id, concept_id, mastery, attempt_count, theta, theta_se, updated_at
        )
        VALUES ($1, $2, 0::numeric, 0, $3::numeric, $4::numeric, NOW())
        ON CONFLICT (user_id, concept_id) DO UPDATE SET
            theta = EXCLUDED.theta,
            theta_se = EXCLUDED.theta_se,
            updated_at = NOW()
        "#,
        schema::LEARNER_CONCEPT_STATES
    ))
    .bind(user_id)
    .bind(concept_id)
    .bind(theta)
    .bind(theta_se)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LearnerThetaMetaRow {
    pub theta: Option<f64>,
    pub theta_se: Option<f64>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub async fn get_learner_theta_meta(
    pool: &PgPool,
    user_id: Uuid,
    concept_id: Uuid,
) -> Result<Option<LearnerThetaMetaRow>, sqlx::Error> {
    sqlx::query_as::<_, LearnerThetaMetaRow>(&format!(
        r#"
        SELECT (theta)::float8 AS theta, (theta_se)::float8 AS theta_se, updated_at
        FROM {}
        WHERE user_id = $1 AND concept_id = $2
        "#,
        schema::LEARNER_CONCEPT_STATES
    ))
    .bind(user_id)
    .bind(concept_id)
    .fetch_optional(pool)
    .await
}

/// Seeds mastery + θ from a completed diagnostic (no quiz attempt id — `attempt_id` is NULL in logs).
pub async fn apply_diagnostic_seed_batch(
    pool: &PgPool,
    user_id: Uuid,
    diagnostic_attempt_id: Uuid,
    seeds: &[(Uuid, f64, Option<f64>, f64, i32)], // concept_id, theta, theta_se, mastery, items_n
) -> Result<(), sqlx::Error> {
    if seeds.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for &(concept_id, theta, theta_se, mastery, items_n) in seeds {
        let idempotency_key = format!("diagnostic:{diagnostic_attempt_id}:{concept_id}");
        let event_id: Option<Uuid> = sqlx::query_scalar(&format!(
            r#"
            INSERT INTO {} (
                user_id, concept_id, attempt_id, delta, mastery_after, source, idempotency_key
            )
            VALUES ($1, $2, NULL, 0::numeric, $3::numeric, 'diagnostic_seed', $4)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id
            "#,
            schema::LEARNER_CONCEPT_EVENTS
        ))
        .bind(user_id)
        .bind(concept_id)
        .bind(mastery)
        .bind(&idempotency_key)
        .fetch_optional(&mut *tx)
        .await?;

        if event_id.is_none() {
            continue;
        }

        sqlx::query(&format!(
            r#"
            INSERT INTO {} (user_id, concept_id, attempt_id, theta, theta_se, items_n)
            VALUES ($1, $2, NULL, $3::numeric, $4::numeric, $5)
            "#,
            schema::LEARNER_THETA_EVENTS
        ))
        .bind(user_id)
        .bind(concept_id)
        .bind(theta)
        .bind(theta_se)
        .bind(items_n)
        .execute(&mut *tx)
        .await?;

        sqlx::query(&format!(
            r#"
            INSERT INTO {} (
                user_id, concept_id, mastery, attempt_count, theta, theta_se, last_seen_at, updated_at
            )
            VALUES ($1, $2, $3::numeric, 1, $4::numeric, $5::numeric, NOW(), NOW())
            ON CONFLICT (user_id, concept_id) DO UPDATE SET
                mastery = EXCLUDED.mastery,
                theta = EXCLUDED.theta,
                theta_se = EXCLUDED.theta_se,
                attempt_count = {}.attempt_count + 1,
                last_seen_at = NOW(),
                updated_at = NOW()
            "#,
            schema::LEARNER_CONCEPT_STATES, schema::LEARNER_CONCEPT_STATES,
        ))
        .bind(user_id)
        .bind(concept_id)
        .bind(mastery)
        .bind(theta)
        .bind(theta_se)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
