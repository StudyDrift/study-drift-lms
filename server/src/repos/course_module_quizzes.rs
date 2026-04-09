use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::types::Json;
use sqlx::PgPool;
use sqlx::Postgres;
use sqlx::Transaction;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_module_quiz::QuizQuestion;

type CourseItemQuizRow = (
    String,
    String,
    Option<DateTime<Utc>>,
    Json<Vec<QuizQuestion>>,
    DateTime<Utc>,
);

pub async fn insert_empty_for_item(
    tx: &mut Transaction<'_, Postgres>,
    structure_item_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (structure_item_id, markdown, questions_json, updated_at)
        VALUES ($1, '', '[]'::jsonb, NOW())
        "#,
        schema::MODULE_QUIZZES
    ))
    .bind(structure_item_id)
    .execute(tx.deref_mut())
    .await?;
    Ok(())
}

pub async fn get_for_course_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CourseItemQuizRow>, sqlx::Error> {
    let row: Option<CourseItemQuizRow> = sqlx::query_as(&format!(
        r#"
        SELECT c.title, m.markdown, c.due_at, m.questions_json, m.updated_at
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'quiz'
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_QUIZZES
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn update_markdown(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET markdown = $3, updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'quiz'
        RETURNING m.updated_at
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .fetch_optional(pool)
    .await
}

pub async fn update_questions(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    questions: &[QuizQuestion],
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET questions_json = $3, updated_at = NOW()
        FROM {} c
        WHERE m.structure_item_id = c.id
          AND c.id = $1
          AND c.course_id = $2
          AND c.kind = 'quiz'
        RETURNING m.updated_at
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(Json(questions.to_vec()))
    .fetch_optional(pool)
    .await
}
