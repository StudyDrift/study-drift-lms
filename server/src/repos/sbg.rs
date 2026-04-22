//! Standards-based grading: course-scoped standards, alignments, cached proficiencies (plan 3.7).

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, sqlx::FromRow)]
pub struct CourseStandardRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub external_id: Option<String>,
    pub description: String,
    pub subject: Option<String>,
    pub grade_level: Option<String>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct StandardSbgAlignmentRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub standard_id: Uuid,
    pub structure_item_id: Uuid,
    pub alignable_type: String,
    pub alignable_id: Uuid,
    pub weight: f64,
}

pub async fn list_course_standards(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<CourseStandardRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT id, course_id, external_id, description, subject, grade_level,
               "position" AS sort_order, created_at
        FROM {}
        WHERE course_id = $1
        ORDER BY "position" ASC, external_id ASC, description ASC
        "#,
        schema::COURSE_STANDARDS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn import_course_standards_replace(
    pool: &PgPool,
    course_id: Uuid,
    rows: &[(Option<String>, String, Option<String>, Option<String>, i32)],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::STUDENT_STANDARD_PROFICIENCIES
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::STANDARD_SBG_ALIGNMENTS
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::COURSE_STANDARDS
    ))
    .bind(course_id)
    .execute(&mut *tx)
    .await?;
    for (ex, desc, sub, gl, pos) in rows {
        sqlx::query(&format!(
            r#"
            INSERT INTO {}
                (course_id, external_id, description, subject, grade_level, "position")
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            schema::COURSE_STANDARDS
        ))
        .bind(course_id)
        .bind(ex)
        .bind(desc)
        .bind(sub)
        .bind(gl)
        .bind(pos)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn list_alignments_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<StandardSbgAlignmentRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT id, course_id, standard_id, structure_item_id, alignable_type, alignable_id, weight
        FROM {}
        WHERE course_id = $1
        "#,
        schema::STANDARD_SBG_ALIGNMENTS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

/// Rubric / quiz alignments for one module item (criterion uuids or question uuids).
pub async fn list_alignments_for_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Vec<StandardSbgAlignmentRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT id, course_id, standard_id, structure_item_id, alignable_type, alignable_id, weight
        FROM {}
        WHERE course_id = $1 AND structure_item_id = $2
        "#,
        schema::STANDARD_SBG_ALIGNMENTS
    ))
    .bind(course_id)
    .bind(item_id)
    .fetch_all(pool)
    .await
}

/// Replace all alignments for a module item (e.g. after rubric SBG pickers save).
/// Each row: `(standard_id, alignable_id, alignable_type, weight)`.
pub async fn replace_item_alignments(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    new_rows: &[(Uuid, Uuid, String, f64)],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE course_id = $1 AND structure_item_id = $2
        "#,
        schema::STANDARD_SBG_ALIGNMENTS
    ))
    .bind(course_id)
    .bind(item_id)
    .execute(&mut *tx)
    .await?;
    for (standard_id, alignable_id, alignable_type, weight) in new_rows {
        sqlx::query(&format!(
            r#"
            INSERT INTO {}
            (course_id, standard_id, structure_item_id, alignable_type, alignable_id, weight)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            schema::STANDARD_SBG_ALIGNMENTS
        ))
        .bind(course_id)
        .bind(standard_id)
        .bind(item_id)
        .bind(alignable_type.as_str())
        .bind(alignable_id)
        .bind(weight)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct ProficiencyRow {
    pub standard_id: Uuid,
    pub student_id: Uuid,
    pub proficiency: Option<f64>,
    pub level_label: Option<String>,
    pub last_assessed: Option<DateTime<Utc>>,
}

pub async fn list_proficiency_matrix(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<ProficiencyRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT standard_id, student_id, proficiency, level_label, last_assessed
        FROM {}
        WHERE course_id = $1
        "#,
        schema::STUDENT_STANDARD_PROFICIENCIES
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await
}

pub async fn list_proficiency_for_student(
    pool: &PgPool,
    course_id: Uuid,
    student_id: Uuid,
) -> Result<Vec<ProficiencyRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT standard_id, student_id, proficiency, level_label, last_assessed
        FROM {}
        WHERE course_id = $1 AND student_id = $2
        "#,
        schema::STUDENT_STANDARD_PROFICIENCIES
    ))
    .bind(course_id)
    .bind(student_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert_proficiency(
    pool: &PgPool,
    course_id: Uuid,
    student_id: Uuid,
    standard_id: Uuid,
    proficiency: Option<f64>,
    level_label: Option<&str>,
    last_assessed: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    let label = level_label.map(|s| s.to_string());
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, student_id, standard_id, proficiency, level_label, last_assessed, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (course_id, student_id, standard_id)
        DO UPDATE SET
            proficiency = EXCLUDED.proficiency,
            level_label = EXCLUDED.level_label,
            last_assessed = EXCLUDED.last_assessed,
            updated_at = NOW()
        "#,
        schema::STUDENT_STANDARD_PROFICIENCIES
    ))
    .bind(course_id)
    .bind(student_id)
    .bind(standard_id)
    .bind(proficiency)
    .bind(&label)
    .bind(last_assessed)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_proficiencies_for_course(pool: &PgPool, course_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::STUDENT_STANDARD_PROFICIENCIES
    ))
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_one_student(
    pool: &PgPool,
    course_id: Uuid,
    student_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1 AND student_id = $2"#,
        schema::STUDENT_STANDARD_PROFICIENCIES
    ))
    .bind(course_id)
    .bind(student_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_proficiency(
    pool: &PgPool,
    course_id: Uuid,
    student_id: Uuid,
    standard_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE course_id = $1 AND student_id = $2 AND standard_id = $3
        "#,
        schema::STUDENT_STANDARD_PROFICIENCIES
    ))
    .bind(course_id)
    .bind(student_id)
    .bind(standard_id)
    .execute(pool)
    .await?;
    Ok(())
}
