//! Academic standards (`course.standard_*` tables).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct StandardFrameworkRow {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub version: String,
    pub publisher: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct StandardCodeRow {
    pub id: Uuid,
    pub framework_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub code: String,
    pub short_code: Option<String>,
    pub description: String,
    pub grade_band: Option<String>,
    pub depth_level: i16,
    pub archived_at: Option<DateTime<Utc>>,
    pub superseded_by_standard_code_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// Latest active framework row for a logical `code` (e.g. `ccss-math`).
pub async fn get_latest_framework_by_code(
    pool: &PgPool,
    code: &str,
) -> Result<Option<StandardFrameworkRow>, sqlx::Error> {
    sqlx::query_as::<_, StandardFrameworkRow>(&format!(
        r#"
        SELECT id, code, name, version, publisher, archived_at, created_at
        FROM {}
        WHERE code = $1 AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        "#,
        schema::STANDARD_FRAMEWORKS
    ))
    .bind(code)
    .fetch_optional(pool)
    .await
}

pub async fn get_framework_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<StandardFrameworkRow>, sqlx::Error> {
    sqlx::query_as::<_, StandardFrameworkRow>(&format!(
        r#"
        SELECT id, code, name, version, publisher, archived_at, created_at
        FROM {}
        WHERE id = $1
        "#,
        schema::STANDARD_FRAMEWORKS
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_standard_code_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<StandardCodeRow>, sqlx::Error> {
    sqlx::query_as::<_, StandardCodeRow>(&format!(
        r#"
        SELECT
            id,
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level,
            archived_at,
            superseded_by_standard_code_id,
            created_at
        FROM {}
        WHERE id = $1
        "#,
        schema::STANDARD_CODES
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn list_standard_codes(
    pool: &PgPool,
    framework_id: Uuid,
    grade_band: Option<&str>,
    fts_query: Option<&str>,
    limit: i64,
) -> Result<Vec<StandardCodeRow>, sqlx::Error> {
    if let Some(q) = fts_query.filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", q.trim());
        return sqlx::query_as::<_, StandardCodeRow>(&format!(
            r#"
            SELECT
                id,
                framework_id,
                parent_id,
                code,
                short_code,
                description,
                grade_band,
                depth_level,
                archived_at,
                superseded_by_standard_code_id,
                created_at
            FROM {}
            WHERE framework_id = $1
              AND archived_at IS NULL
              AND ($2::text IS NULL OR grade_band = $2)
              AND (
                code ILIKE $3
                OR short_code ILIKE $3
                OR description ILIKE $3
                OR to_tsvector('english', code || ' ' || COALESCE(description, ''))
                    @@ plainto_tsquery('english', $4)
              )
            ORDER BY code ASC
            LIMIT $5
            "#,
            schema::STANDARD_CODES
        ))
        .bind(framework_id)
        .bind(grade_band)
        .bind(&pattern)
        .bind(q.trim())
        .bind(limit)
        .fetch_all(pool)
        .await;
    }

    sqlx::query_as::<_, StandardCodeRow>(&format!(
        r#"
        SELECT
            id,
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level,
            archived_at,
            superseded_by_standard_code_id,
            created_at
        FROM {}
        WHERE framework_id = $1
          AND archived_at IS NULL
          AND ($2::text IS NULL OR grade_band = $2)
        ORDER BY code ASC
        LIMIT $3
        "#,
        schema::STANDARD_CODES
    ))
    .bind(framework_id)
    .bind(grade_band)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn search_standard_codes(
    pool: &PgPool,
    framework_id: Uuid,
    q: &str,
    limit: i64,
) -> Result<Vec<StandardCodeRow>, sqlx::Error> {
    let pattern = format!("%{}%", q.trim());
    sqlx::query_as::<_, StandardCodeRow>(&format!(
        r#"
        SELECT
            id,
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level,
            archived_at,
            superseded_by_standard_code_id,
            created_at
        FROM {}
        WHERE framework_id = $1
          AND archived_at IS NULL
          AND (
            code ILIKE $2
            OR short_code ILIKE $2
            OR description ILIKE $2
            OR to_tsvector('english', code || ' ' || COALESCE(description, ''))
                @@ plainto_tsquery('english', $3)
          )
        ORDER BY code ASC
        LIMIT $4
        "#,
        schema::STANDARD_CODES
    ))
    .bind(framework_id)
    .bind(&pattern)
    .bind(q.trim())
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn upsert_framework(
    pool: &PgPool,
    code: &str,
    name: &str,
    version: &str,
    publisher: Option<&str>,
) -> Result<StandardFrameworkRow, sqlx::Error> {
    sqlx::query_as::<_, StandardFrameworkRow>(&format!(
        r#"
        INSERT INTO {} (code, name, version, publisher)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code, version) DO UPDATE SET
            name = EXCLUDED.name,
            publisher = EXCLUDED.publisher
        RETURNING id, code, name, version, publisher, archived_at, created_at
        "#,
        schema::STANDARD_FRAMEWORKS
    ))
    .bind(code)
    .bind(name)
    .bind(version)
    .bind(publisher)
    .fetch_one(pool)
    .await
}

pub async fn upsert_standard_code(
    pool: &PgPool,
    framework_id: Uuid,
    parent_id: Option<Uuid>,
    code: &str,
    short_code: Option<&str>,
    description: &str,
    grade_band: Option<&str>,
    depth_level: i16,
) -> Result<StandardCodeRow, sqlx::Error> {
    sqlx::query_as::<_, StandardCodeRow>(&format!(
        r#"
        INSERT INTO {} (
            framework_id, parent_id, code, short_code, description, grade_band, depth_level
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (framework_id, code) DO UPDATE SET
            parent_id = EXCLUDED.parent_id,
            short_code = EXCLUDED.short_code,
            description = EXCLUDED.description,
            grade_band = EXCLUDED.grade_band,
            depth_level = EXCLUDED.depth_level,
            archived_at = NULL
        RETURNING
            id,
            framework_id,
            parent_id,
            code,
            short_code,
            description,
            grade_band,
            depth_level,
            archived_at,
            superseded_by_standard_code_id,
            created_at
        "#,
        schema::STANDARD_CODES
    ))
    .bind(framework_id)
    .bind(parent_id)
    .bind(code)
    .bind(short_code)
    .bind(description)
    .bind(grade_band)
    .bind(depth_level)
    .fetch_one(pool)
    .await
}

pub async fn insert_concept_alignment(
    pool: &PgPool,
    concept_id: Uuid,
    standard_code_id: Uuid,
    alignment_type: &str,
    created_by: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (concept_id, standard_code_id, alignment_type, created_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (concept_id, standard_code_id) DO UPDATE SET
            alignment_type = EXCLUDED.alignment_type
        "#,
        schema::CONCEPT_STANDARD_ALIGNMENTS
    ))
    .bind(concept_id)
    .bind(standard_code_id)
    .bind(alignment_type)
    .bind(created_by)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_concept_alignment(
    pool: &PgPool,
    concept_id: Uuid,
    standard_code_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(&format!(
        r#"DELETE FROM {} WHERE concept_id = $1 AND standard_code_id = $2"#,
        schema::CONCEPT_STANDARD_ALIGNMENTS
    ))
    .bind(concept_id)
    .bind(standard_code_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn list_alignments_for_concept(
    pool: &PgPool,
    concept_id: Uuid,
) -> Result<Vec<StandardCodeRow>, sqlx::Error> {
    sqlx::query_as::<_, StandardCodeRow>(&format!(
        r#"
        SELECT
            sc.id,
            sc.framework_id,
            sc.parent_id,
            sc.code,
            sc.short_code,
            sc.description,
            sc.grade_band,
            sc.depth_level,
            sc.archived_at,
            sc.superseded_by_standard_code_id,
            sc.created_at
        FROM {} csa
        INNER JOIN {} sc ON sc.id = csa.standard_code_id
        WHERE csa.concept_id = $1
        ORDER BY sc.code ASC
        "#,
        schema::CONCEPT_STANDARD_ALIGNMENTS,
        schema::STANDARD_CODES
    ))
    .bind(concept_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StandardCoverageRow {
    pub standard_code_id: Uuid,
    pub code: String,
    pub short_code: Option<String>,
    pub description: String,
    pub grade_band: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub superseded_by_standard_code_id: Option<Uuid>,
    pub question_count: i64,
    pub average_mastery: Option<f64>,
    pub coverage_status: String,
}

pub async fn standards_coverage_for_course(
    pool: &PgPool,
    course_id: Uuid,
    framework_id: Uuid,
    grade_band: Option<&str>,
) -> Result<Vec<StandardCoverageRow>, sqlx::Error> {
    sqlx::query_as::<_, StandardCoverageRow>(
        r#"
        WITH leaves AS (
            SELECT sc.*
            FROM course.standard_codes sc
            WHERE sc.framework_id = $2
              AND sc.depth_level = 4
              AND ($3::text IS NULL OR sc.grade_band = $3)
        ),
        via_concept AS (
            SELECT
                csa.standard_code_id,
                COUNT(DISTINCT q.id)::bigint AS n
            FROM course.concept_standard_alignments csa
            INNER JOIN course.concept_question_tags cqt ON cqt.concept_id = csa.concept_id
            INNER JOIN course.questions q ON q.id = cqt.question_id AND q.course_id = $1
            GROUP BY csa.standard_code_id
        ),
        via_question AS (
            SELECT
                qsa.standard_code_id,
                COUNT(DISTINCT q.id)::bigint AS n
            FROM course.question_standard_alignments qsa
            INNER JOIN course.questions q ON q.id = qsa.question_id AND q.course_id = $1
            GROUP BY qsa.standard_code_id
        ),
        mastery AS (
            SELECT
                csa.standard_code_id,
                AVG(lcs.mastery::float8) AS avg_m
            FROM course.concept_standard_alignments csa
            INNER JOIN course.learner_concept_states lcs ON lcs.concept_id = csa.concept_id
            INNER JOIN course.course_enrollments ce
                ON ce.user_id = lcs.user_id AND ce.course_id = $1 AND ce.role = 'student'
            GROUP BY csa.standard_code_id
        )
        SELECT
            l.id AS standard_code_id,
            l.code,
            l.short_code,
            l.description,
            l.grade_band,
            l.archived_at,
            l.superseded_by_standard_code_id,
            COALESCE(vc.n, 0) + COALESCE(vq.n, 0) AS question_count,
            m.avg_m AS average_mastery,
            CASE
                WHEN COALESCE(vc.n, 0) + COALESCE(vq.n, 0) = 0 THEN 'none'
                WHEN m.avg_m IS NULL OR m.avg_m < 0.5 THEN 'partial'
                ELSE 'covered'
            END AS coverage_status
        FROM leaves l
        LEFT JOIN via_concept vc ON vc.standard_code_id = l.id
        LEFT JOIN via_question vq ON vq.standard_code_id = l.id
        LEFT JOIN mastery m ON m.standard_code_id = l.id
        ORDER BY l.code ASC
        "#,
    )
    .bind(course_id)
    .bind(framework_id)
    .bind(grade_band)
    .fetch_all(pool)
    .await
}
