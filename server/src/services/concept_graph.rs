//! Concept DAG: slugging, prerequisite insertion with cycle detection, edge-count gauge.

use std::sync::atomic::{AtomicI64, Ordering};

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::concepts::{
    self, ConceptJson, ConceptRow, InsertConceptInput, UpdateConceptInput,
};

static EDGE_COUNT: AtomicI64 = AtomicI64::new(-1);

pub async fn sync_edge_count(pool: &PgPool) {
    if let Ok(n) = concepts::count_prerequisite_edges(pool).await {
        EDGE_COUNT.store(n, Ordering::Relaxed);
    }
}

pub fn approximate_edge_count() -> Option<i64> {
    let v = EDGE_COUNT.load(Ordering::Relaxed);
    if v >= 0 {
        Some(v)
    } else {
        None
    }
}

pub fn slugify_name(name: &str) -> String {
    let mut out = String::new();
    let mut prev_sep = true;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_sep = false;
        } else if (ch.is_whitespace() || ch == '-' || ch == '_') && !out.is_empty() && !prev_sep {
            out.push('-');
            prev_sep = true;
        }
    }
    let t = out.trim_matches('-').to_string();
    if t.is_empty() {
        "concept".to_string()
    } else {
        t
    }
}

pub async fn ensure_unique_slug(pool: &PgPool, base: &str) -> Result<String, sqlx::Error> {
    let mut candidate = base.to_string();
    for _ in 0..64 {
        if concepts::get_by_slug(pool, &candidate).await?.is_none() {
            return Ok(candidate);
        }
        let suffix: String = Uuid::new_v4().to_string().chars().take(8).collect();
        candidate = format!("{base}-{suffix}");
    }
    Ok(format!("{base}-{}", Uuid::new_v4()))
}

pub async fn add_prerequisite(
    pool: &PgPool,
    concept_id: Uuid,
    prerequisite_id: Uuid,
) -> Result<(), AppError> {
    if concept_id == prerequisite_id {
        return Err(AppError::invalid_input(
            "A concept cannot be a prerequisite of itself.",
        ));
    }
    let mut tx = pool.begin().await.map_err(AppError::Db)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *tx)
        .await
        .map_err(AppError::Db)?;
    if concepts::prerequisite_reaches_concept(&mut tx, prerequisite_id, concept_id)
        .await
        .map_err(AppError::Db)?
    {
        return Err(AppError::UnprocessableEntity {
            message: "This prerequisite would create a circular dependency.".into(),
        });
    }
    concepts::insert_prerequisite_edge(&mut tx, concept_id, prerequisite_id)
        .await
        .map_err(AppError::Db)?;
    tx.commit().await.map_err(AppError::Db)?;
    sync_edge_count(pool).await;
    tracing::info!(
        target: "concept_graph",
        concept_id = %concept_id,
        prerequisite_id = %prerequisite_id,
        "concept_graph.edge_added"
    );
    Ok(())
}

pub async fn create_concept(
    pool: &PgPool,
    name: &str,
    description: Option<String>,
    bloom_level: Option<String>,
    parent_concept_id: Option<Uuid>,
) -> Result<ConceptJson, AppError> {
    let base = slugify_name(name);
    let slug = ensure_unique_slug(pool, &base)
        .await
        .map_err(AppError::Db)?;
    let row = concepts::insert_concept(
        pool,
        &InsertConceptInput {
            slug,
            name: name.to_string(),
            description,
            bloom_level,
            parent_concept_id,
        },
    )
    .await
    .map_err(AppError::Db)?;
    tracing::info!(
        target: "concept_graph",
        concept_id = %row.id,
        slug = %row.slug,
        "concept_graph.concept_created"
    );
    Ok(ConceptJson::from(row))
}

pub async fn update_concept(
    pool: &PgPool,
    id: Uuid,
    name: String,
    description: Option<String>,
    bloom_level: Option<String>,
    parent_concept_id: Option<Option<Uuid>>,
) -> Result<Option<ConceptJson>, AppError> {
    let row = concepts::update_concept(
        pool,
        id,
        &UpdateConceptInput {
            name: Some(name),
            description,
            bloom_level,
            parent_concept_id,
        },
    )
    .await
    .map_err(AppError::Db)?;
    Ok(row.map(ConceptJson::from))
}

pub fn row_to_json(row: ConceptRow) -> ConceptJson {
    ConceptJson::from(row)
}

pub async fn delete_prerequisite_edge(
    pool: &PgPool,
    concept_id: Uuid,
    prerequisite_id: Uuid,
) -> Result<bool, AppError> {
    let ok = concepts::delete_prerequisite_edge(pool, concept_id, prerequisite_id)
        .await
        .map_err(AppError::Db)?;
    if ok {
        sync_edge_count(pool).await;
    }
    Ok(ok)
}

#[cfg(test)]
mod tests {
    use super::slugify_name;

    #[test]
    fn slugify_ascii_and_unicode() {
        assert_eq!(
            slugify_name("  Solving Linear Equations  "),
            "solving-linear-equations"
        );
        assert_eq!(slugify_name("café"), "caf");
    }
}
