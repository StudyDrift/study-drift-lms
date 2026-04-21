//! Concept graph (`course.concepts`, prerequisites, question tags).

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ConceptRow {
    pub id: Uuid,
    pub course_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub bloom_level: Option<String>,
    pub parent_concept_id: Option<Uuid>,
    pub difficulty_tier: String,
    pub decay_lambda: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptJson {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub bloom_level: Option<String>,
    pub parent_concept_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<ConceptRow> for ConceptJson {
    fn from(r: ConceptRow) -> Self {
        ConceptJson {
            id: r.id,
            slug: r.slug,
            name: r.name,
            description: r.description,
            bloom_level: r.bloom_level,
            parent_concept_id: r.parent_concept_id,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<Option<ConceptRow>, sqlx::Error> {
    sqlx::query_as::<_, ConceptRow>(&format!(
        r#"
        SELECT
            id,
            course_id,
            slug,
            name,
            description,
            bloom_level::text AS bloom_level,
            parent_concept_id,
            difficulty_tier,
            (decay_lambda)::float8 AS decay_lambda,
            created_at,
            updated_at
        FROM {}
        WHERE id = $1
        "#,
        schema::CONCEPTS
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_by_slug(pool: &PgPool, slug: &str) -> Result<Option<ConceptRow>, sqlx::Error> {
    sqlx::query_as::<_, ConceptRow>(&format!(
        r#"
        SELECT
            id,
            course_id,
            slug,
            name,
            description,
            bloom_level::text AS bloom_level,
            parent_concept_id,
            difficulty_tier,
            (decay_lambda)::float8 AS decay_lambda,
            created_at,
            updated_at
        FROM {}
        WHERE slug = $1
        "#,
        schema::CONCEPTS
    ))
    .bind(slug)
    .fetch_optional(pool)
    .await
}

pub struct ListConceptsQuery<'a> {
    pub parent_slug: Option<&'a str>,
    pub bloom: Option<&'a str>,
    pub q: Option<&'a str>,
}

pub async fn list_concepts_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<ConceptRow>, sqlx::Error> {
    sqlx::query_as::<_, ConceptRow>(&format!(
        r#"
        SELECT
            c.id,
            c.course_id,
            c.slug,
            c.name,
            c.description,
            c.bloom_level::text AS bloom_level,
            c.parent_concept_id,
            c.difficulty_tier,
            (c.decay_lambda)::float8 AS decay_lambda,
            c.created_at,
            c.updated_at
        FROM {} c
        WHERE c.course_id = $1
        ORDER BY c.name ASC
        "#,
        schema::CONCEPTS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn list_concepts(
    pool: &PgPool,
    query: ListConceptsQuery<'_>,
) -> Result<Vec<ConceptRow>, sqlx::Error> {
    let parent_id: Option<Uuid> = if let Some(ps) = query.parent_slug {
        let Some(row) = get_by_slug(pool, ps).await? else {
            return Ok(vec![]);
        };
        Some(row.id)
    } else {
        None
    };

    sqlx::query_as::<_, ConceptRow>(&format!(
        r#"
        SELECT
            c.id,
            c.course_id,
            c.slug,
            c.name,
            c.description,
            c.bloom_level::text AS bloom_level,
            c.parent_concept_id,
            c.difficulty_tier,
            (c.decay_lambda)::float8 AS decay_lambda,
            c.created_at,
            c.updated_at
        FROM {} c
        WHERE ($1::uuid IS NULL OR c.parent_concept_id = $1)
          AND ($2::text IS NULL OR c.bloom_level::text = $2)
          AND (
            $3::text IS NULL
            OR trim($3) = ''
            OR to_tsvector('english', c.name || ' ' || COALESCE(c.description, ''))
               @@ websearch_to_tsquery('english', $3)
          )
        ORDER BY c.name ASC
        "#,
        schema::CONCEPTS
    ))
    .bind(parent_id)
    .bind(query.bloom)
    .bind(query.q)
    .fetch_all(pool)
    .await
}

pub async fn search_concepts_fts(
    pool: &PgPool,
    search: &str,
    limit: i64,
) -> Result<Vec<ConceptRow>, sqlx::Error> {
    let q = search.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as::<_, ConceptRow>(&format!(
        r#"
        SELECT
            c.id,
            c.course_id,
            c.slug,
            c.name,
            c.description,
            c.bloom_level::text AS bloom_level,
            c.parent_concept_id,
            c.difficulty_tier,
            (c.decay_lambda)::float8 AS decay_lambda,
            c.created_at,
            c.updated_at
        FROM {} c
        WHERE to_tsvector('english', c.name || ' ' || COALESCE(c.description, ''))
              @@ websearch_to_tsquery('english', $1)
        ORDER BY ts_rank(
            to_tsvector('english', c.name || ' ' || COALESCE(c.description, '')),
            websearch_to_tsquery('english', $1)
        ) DESC,
        c.name ASC
        LIMIT $2
        "#,
        schema::CONCEPTS
    ))
    .bind(q)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub struct InsertConceptInput {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub bloom_level: Option<String>,
    pub parent_concept_id: Option<Uuid>,
}

pub async fn insert_concept(
    pool: &PgPool,
    input: &InsertConceptInput,
) -> Result<ConceptRow, sqlx::Error> {
    let row = sqlx::query_as::<_, ConceptRow>(&format!(
        r#"
        INSERT INTO {} (
            course_id, slug, name, description, bloom_level, parent_concept_id
        )
        VALUES (
            NULL, $1, $2, $3,
            $4::course.bloom_level,
            $5
        )
        RETURNING
            id,
            course_id,
            slug,
            name,
            description,
            bloom_level::text AS bloom_level,
            parent_concept_id,
            difficulty_tier,
            (decay_lambda)::float8 AS decay_lambda,
            created_at,
            updated_at
        "#,
        schema::CONCEPTS
    ))
    .bind(&input.slug)
    .bind(&input.name)
    .bind(&input.description)
    .bind(&input.bloom_level)
    .bind(input.parent_concept_id)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub struct UpdateConceptInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub bloom_level: Option<String>,
    pub parent_concept_id: Option<Option<Uuid>>,
}

pub async fn update_concept(
    pool: &PgPool,
    id: Uuid,
    patch: &UpdateConceptInput,
) -> Result<Option<ConceptRow>, sqlx::Error> {
    let Some(name) = patch.name.as_ref() else {
        return get_by_id(pool, id).await;
    };
    let desc = patch.description.as_ref();
    let bloom = patch.bloom_level.as_deref();
    let parent = patch.parent_concept_id;

    let row = if let Some(p) = parent {
        sqlx::query_as::<_, ConceptRow>(&format!(
            r#"
            UPDATE {}
            SET
                name = $2,
                description = COALESCE($3, description),
                bloom_level = COALESCE($4::course.bloom_level, bloom_level),
                parent_concept_id = $5,
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id,
                course_id,
                slug,
                name,
                description,
                bloom_level::text AS bloom_level,
                parent_concept_id,
                difficulty_tier,
                (decay_lambda)::float8 AS decay_lambda,
                created_at,
                updated_at
            "#,
            schema::CONCEPTS
        ))
        .bind(id)
        .bind(name)
        .bind(desc)
        .bind(bloom)
        .bind(p)
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query_as::<_, ConceptRow>(&format!(
            r#"
            UPDATE {}
            SET
                name = $2,
                description = COALESCE($3, description),
                bloom_level = COALESCE($4::course.bloom_level, bloom_level),
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id,
                course_id,
                slug,
                name,
                description,
                bloom_level::text AS bloom_level,
                parent_concept_id,
                difficulty_tier,
                (decay_lambda)::float8 AS decay_lambda,
                created_at,
                updated_at
            "#,
            schema::CONCEPTS
        ))
        .bind(id)
        .bind(name)
        .bind(desc)
        .bind(bloom)
        .fetch_optional(pool)
        .await?
    };
    Ok(row)
}

pub async fn delete_concept(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!("DELETE FROM {} WHERE id = $1", schema::CONCEPTS))
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// Before inserting edge (concept_id, prerequisite_id): true if `prerequisite_id` can already reach `concept_id` (adding the edge would close a cycle).
pub async fn prerequisite_reaches_concept(
    tx: &mut Transaction<'_, Postgres>,
    prerequisite_id: Uuid,
    concept_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let found: Option<(bool,)> = sqlx::query_as(
        r#"
        WITH RECURSIVE reach AS (
            SELECT cp.prerequisite_id AS node, 1 AS depth
            FROM course.concept_prerequisites cp
            WHERE cp.concept_id = $1
            UNION ALL
            SELECT cp.prerequisite_id, reach.depth + 1
            FROM course.concept_prerequisites cp
            INNER JOIN reach ON cp.concept_id = reach.node
            WHERE reach.depth < 64
        )
        SELECT EXISTS (SELECT 1 FROM reach WHERE node = $2)
        "#,
    )
    .bind(prerequisite_id)
    .bind(concept_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(found.map(|(b,)| b).unwrap_or(false))
}

pub async fn insert_prerequisite_edge(
    tx: &mut Transaction<'_, Postgres>,
    concept_id: Uuid,
    prerequisite_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (concept_id, prerequisite_id)
        VALUES ($1, $2)
        "#,
        schema::CONCEPT_PREREQUISITES
    ))
    .bind(concept_id)
    .bind(prerequisite_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn delete_prerequisite_edge(
    pool: &PgPool,
    concept_id: Uuid,
    prerequisite_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE concept_id = $1 AND prerequisite_id = $2
        "#,
        schema::CONCEPT_PREREQUISITES
    ))
    .bind(concept_id)
    .bind(prerequisite_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphBundle {
    pub nodes: Vec<ConceptJson>,
    pub edges: Vec<[Uuid; 2]>,
}

pub async fn list_ancestors(pool: &PgPool, concept_id: Uuid) -> Result<GraphBundle, sqlx::Error> {
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"
        WITH RECURSIVE anc_ids AS (
            SELECT prerequisite_id AS id, 1 AS depth
            FROM course.concept_prerequisites
            WHERE concept_id = $1
            UNION ALL
            SELECT cp.prerequisite_id, anc_ids.depth + 1
            FROM course.concept_prerequisites cp
            INNER JOIN anc_ids ON cp.concept_id = anc_ids.id
            WHERE anc_ids.depth < 64
        ),
        all_ids AS (
            SELECT id FROM anc_ids
            UNION
            SELECT $1::uuid
        )
        SELECT cp.concept_id, cp.prerequisite_id
        FROM course.concept_prerequisites cp
        WHERE cp.concept_id IN (SELECT id FROM all_ids)
          AND cp.prerequisite_id IN (SELECT id FROM all_ids)
        "#,
    )
    .bind(concept_id)
    .fetch_all(pool)
    .await?;

    let mut node_ids = std::collections::HashSet::new();
    node_ids.insert(concept_id);
    for (a, b) in &rows {
        node_ids.insert(*a);
        node_ids.insert(*b);
    }
    let nodes = load_concepts_by_ids(pool, &node_ids.into_iter().collect::<Vec<_>>()).await?;
    let edges: Vec<[Uuid; 2]> = rows.iter().map(|(a, b)| [*a, *b]).collect();
    Ok(GraphBundle {
        nodes: nodes.into_iter().map(ConceptJson::from).collect(),
        edges,
    })
}

pub async fn list_descendants(pool: &PgPool, concept_id: Uuid) -> Result<GraphBundle, sqlx::Error> {
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"
        WITH RECURSIVE desc_ids AS (
            SELECT concept_id AS id, 1 AS depth
            FROM course.concept_prerequisites
            WHERE prerequisite_id = $1
            UNION ALL
            SELECT cp.concept_id, desc_ids.depth + 1
            FROM course.concept_prerequisites cp
            INNER JOIN desc_ids ON cp.prerequisite_id = desc_ids.id
            WHERE desc_ids.depth < 64
        ),
        all_ids AS (
            SELECT id FROM desc_ids
            UNION
            SELECT $1::uuid
        )
        SELECT cp.concept_id, cp.prerequisite_id
        FROM course.concept_prerequisites cp
        WHERE cp.concept_id IN (SELECT id FROM all_ids)
          AND cp.prerequisite_id IN (SELECT id FROM all_ids)
        "#,
    )
    .bind(concept_id)
    .fetch_all(pool)
    .await?;

    let mut node_ids = std::collections::HashSet::new();
    node_ids.insert(concept_id);
    for (a, b) in &rows {
        node_ids.insert(*a);
        node_ids.insert(*b);
    }
    let nodes = load_concepts_by_ids(pool, &node_ids.into_iter().collect::<Vec<_>>()).await?;
    let edges: Vec<[Uuid; 2]> = rows.iter().map(|(a, b)| [*a, *b]).collect();
    Ok(GraphBundle {
        nodes: nodes.into_iter().map(ConceptJson::from).collect(),
        edges,
    })
}

async fn load_concepts_by_ids(
    pool: &PgPool,
    ids: &[Uuid],
) -> Result<Vec<ConceptRow>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as::<_, ConceptRow>(&format!(
        r#"
        SELECT
            id,
            course_id,
            slug,
            name,
            description,
            bloom_level::text AS bloom_level,
            parent_concept_id,
            difficulty_tier,
            (decay_lambda)::float8 AS decay_lambda,
            created_at,
            updated_at
        FROM {}
        WHERE id = ANY($1)
        ORDER BY name ASC
        "#,
        schema::CONCEPTS
    ))
    .bind(ids)
    .fetch_all(pool)
    .await
}

pub async fn count_prerequisite_edges(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(&format!(
        "SELECT COUNT(*)::bigint FROM {}",
        schema::CONCEPT_PREREQUISITES
    ))
    .fetch_one(pool)
    .await
}

pub async fn insert_question_tag(
    pool: &PgPool,
    concept_id: Uuid,
    question_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (concept_id, question_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        "#,
        schema::CONCEPT_QUESTION_TAGS
    ))
    .bind(concept_id)
    .bind(question_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_question_tag(
    pool: &PgPool,
    concept_id: Uuid,
    question_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE concept_id = $1 AND question_id = $2
        "#,
        schema::CONCEPT_QUESTION_TAGS
    ))
    .bind(concept_id)
    .bind(question_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

pub async fn concept_ids_for_question_ids(
    pool: &PgPool,
    question_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<Uuid>>, sqlx::Error> {
    if question_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        &format!(
            r#"
            SELECT question_id, concept_id
            FROM {}
            WHERE question_id = ANY($1)
            "#,
            schema::CONCEPT_QUESTION_TAGS
        ),
    )
    .bind(question_ids)
    .fetch_all(pool)
    .await?;

    let mut m: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (qid, cid) in rows {
        m.entry(qid).or_default().push(cid);
    }
    Ok(m)
}
