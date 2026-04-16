use std::collections::HashMap;
use std::ops::DerefMut;

use chrono::{DateTime, Utc};
use sqlx::types::Json;
use sqlx::FromRow;
use sqlx::PgPool;
use sqlx::Postgres;
use sqlx::Transaction;
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_module_quiz::QuizQuestion;

#[derive(Debug, FromRow)]
pub struct CourseItemQuizRow {
    pub title: String,
    pub markdown: String,
    pub due_at: Option<DateTime<Utc>>,
    pub questions_json: Json<Vec<QuizQuestion>>,
    pub updated_at: DateTime<Utc>,
    pub available_from: Option<DateTime<Utc>>,
    pub available_until: Option<DateTime<Utc>>,
    pub unlimited_attempts: bool,
    pub max_attempts: i32,
    pub grade_attempt_policy: String,
    pub passing_score_percent: Option<i32>,
    pub points_worth: Option<i32>,
    pub late_submission_policy: String,
    pub late_penalty_percent: Option<i32>,
    pub time_limit_minutes: Option<i32>,
    pub timer_pause_when_tab_hidden: bool,
    pub per_question_time_limit_seconds: Option<i32>,
    pub show_score_timing: String,
    pub review_visibility: String,
    pub review_when: String,
    pub one_question_at_a_time: bool,
    pub shuffle_questions: bool,
    pub shuffle_choices: bool,
    pub allow_back_navigation: bool,
    pub quiz_access_code: Option<String>,
    pub adaptive_difficulty: String,
    pub adaptive_topic_balance: bool,
    pub adaptive_stop_rule: String,
    pub random_question_pool_count: Option<i32>,
    pub is_adaptive: bool,
    pub adaptive_system_prompt: String,
    pub adaptive_source_item_ids: Json<Vec<Uuid>>,
    pub adaptive_question_count: i32,
    pub assignment_group_id: Option<Uuid>,
}

/// Full quiz scheduling / behavior row for PATCH merge + UPDATE.
#[derive(Debug, Clone)]
pub struct QuizSettingsWrite {
    pub available_from: Option<DateTime<Utc>>,
    pub available_until: Option<DateTime<Utc>>,
    pub unlimited_attempts: bool,
    pub max_attempts: i32,
    pub grade_attempt_policy: String,
    pub passing_score_percent: Option<i32>,
    pub points_worth: Option<i32>,
    pub late_submission_policy: String,
    pub late_penalty_percent: Option<i32>,
    pub time_limit_minutes: Option<i32>,
    pub timer_pause_when_tab_hidden: bool,
    pub per_question_time_limit_seconds: Option<i32>,
    pub show_score_timing: String,
    pub review_visibility: String,
    pub review_when: String,
    pub one_question_at_a_time: bool,
    pub shuffle_questions: bool,
    pub shuffle_choices: bool,
    pub allow_back_navigation: bool,
    pub quiz_access_code: Option<String>,
    pub adaptive_difficulty: String,
    pub adaptive_topic_balance: bool,
    pub adaptive_stop_rule: String,
    pub random_question_pool_count: Option<i32>,
}

impl From<&CourseItemQuizRow> for QuizSettingsWrite {
    fn from(row: &CourseItemQuizRow) -> Self {
        Self {
            available_from: row.available_from,
            available_until: row.available_until,
            unlimited_attempts: row.unlimited_attempts,
            max_attempts: row.max_attempts,
            grade_attempt_policy: row.grade_attempt_policy.clone(),
            passing_score_percent: row.passing_score_percent,
            points_worth: row.points_worth,
            late_submission_policy: row.late_submission_policy.clone(),
            late_penalty_percent: row.late_penalty_percent,
            time_limit_minutes: row.time_limit_minutes,
            timer_pause_when_tab_hidden: row.timer_pause_when_tab_hidden,
            per_question_time_limit_seconds: row.per_question_time_limit_seconds,
            show_score_timing: row.show_score_timing.clone(),
            review_visibility: row.review_visibility.clone(),
            review_when: row.review_when.clone(),
            one_question_at_a_time: row.one_question_at_a_time,
            shuffle_questions: row.shuffle_questions,
            shuffle_choices: row.shuffle_choices,
            allow_back_navigation: row.allow_back_navigation,
            quiz_access_code: row.quiz_access_code.clone(),
            adaptive_difficulty: row.adaptive_difficulty.clone(),
            adaptive_topic_balance: row.adaptive_topic_balance,
            adaptive_stop_rule: row.adaptive_stop_rule.clone(),
            random_question_pool_count: row.random_question_pool_count,
        }
    }
}

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

/// Per-quiz metadata for course structure lists (`is_adaptive` + fixed-question point total).
pub async fn quiz_outline_for_structure_items(
    pool: &PgPool,
    course_id: Uuid,
    structure_item_ids: &[Uuid],
) -> Result<HashMap<Uuid, QuizStructureListOutline>, sqlx::Error> {
    if structure_item_ids.is_empty() {
        return Ok(HashMap::new());
    }
    #[derive(Debug, Clone, FromRow)]
    struct Row {
        id: Uuid,
        is_adaptive: bool,
        question_points_total: i32,
        points_worth: Option<i32>,
    }
    let rows: Vec<Row> = sqlx::query_as(&format!(
        r#"
        SELECT
            c.id,
            m.is_adaptive,
            COALESCE(
                (
                    SELECT SUM((elem->>'points')::int)
                    FROM jsonb_array_elements(m.questions_json) AS elem
                ),
                0
            )::int AS question_points_total,
            m.points_worth
        FROM {} c
        INNER JOIN {} m ON m.structure_item_id = c.id
        WHERE c.course_id = $1 AND c.kind = 'quiz' AND c.id = ANY($2)
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_QUIZZES
    ))
    .bind(course_id)
    .bind(structure_item_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.id,
                QuizStructureListOutline {
                    is_adaptive: r.is_adaptive,
                    question_points_total: r.question_points_total,
                    points_worth: r.points_worth,
                },
            )
        })
        .collect())
}

#[derive(Debug, Clone)]
pub struct QuizStructureListOutline {
    pub is_adaptive: bool,
    pub question_points_total: i32,
    pub points_worth: Option<i32>,
}

pub async fn get_for_course_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CourseItemQuizRow>, sqlx::Error> {
    let row: Option<CourseItemQuizRow> = sqlx::query_as(&format!(
        r#"
        SELECT c.title, m.markdown, c.due_at, m.questions_json, m.updated_at,
               m.available_from, m.available_until, m.unlimited_attempts, m.max_attempts,
               m.grade_attempt_policy, m.passing_score_percent, m.points_worth, m.late_submission_policy, m.late_penalty_percent,
               m.time_limit_minutes, m.timer_pause_when_tab_hidden, m.per_question_time_limit_seconds,
               m.show_score_timing, m.review_visibility, m.review_when,
               m.one_question_at_a_time, m.shuffle_questions, m.shuffle_choices, m.allow_back_navigation,
               m.quiz_access_code, m.adaptive_difficulty, m.adaptive_topic_balance, m.adaptive_stop_rule,
               m.random_question_pool_count,
               m.is_adaptive, m.adaptive_system_prompt, m.adaptive_source_item_ids, m.adaptive_question_count,
               c.assignment_group_id
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

/// Markdown bodies for structure items (content pages, assignments, quiz intros), in course order of `ids`.
pub async fn reference_markdown_for_items(
    pool: &PgPool,
    course_id: Uuid,
    ids: &[Uuid],
) -> Result<String, sqlx::Error> {
    if ids.is_empty() {
        return Ok(String::new());
    }
    #[derive(FromRow)]
    struct RefRow {
        id: Uuid,
        title: String,
        kind: String,
        body: String,
    }
    let rows: Vec<RefRow> = sqlx::query_as(&format!(
        r#"
        SELECT
            c.id,
            c.title,
            c.kind,
            COALESCE(cp.markdown, asn.markdown, qz.markdown, '') AS body
        FROM {} c
        LEFT JOIN {} cp ON cp.structure_item_id = c.id AND c.kind = 'content_page'
        LEFT JOIN {} asn ON asn.structure_item_id = c.id AND c.kind = 'assignment'
        LEFT JOIN {} qz ON qz.structure_item_id = c.id AND c.kind = 'quiz'
        WHERE c.course_id = $1 AND c.id = ANY($2)
          AND c.kind IN ('content_page', 'assignment', 'quiz')
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_CONTENT_PAGES,
        schema::MODULE_ASSIGNMENTS,
        schema::MODULE_QUIZZES
    ))
    .bind(course_id)
    .bind(ids)
    .fetch_all(pool)
    .await?;

    let mut by_id: HashMap<Uuid, RefRow> = HashMap::with_capacity(rows.len());
    for r in rows {
        by_id.insert(r.id, r);
    }
    let mut blocks = Vec::new();
    for id in ids {
        if let Some(r) = by_id.get(id) {
            blocks.push(format!(
                "---\nItem: {} ({})\n{}\n",
                r.title,
                r.kind,
                r.body.trim()
            ));
        }
    }
    Ok(blocks.join("\n"))
}

pub async fn write_quiz_settings(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    s: &QuizSettingsWrite,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET available_from = $3,
            available_until = $4,
            unlimited_attempts = $5,
            max_attempts = $6,
            grade_attempt_policy = $7,
            passing_score_percent = $8,
            points_worth = $9,
            late_submission_policy = $10,
            late_penalty_percent = $11,
            time_limit_minutes = $12,
            timer_pause_when_tab_hidden = $13,
            per_question_time_limit_seconds = $14,
            show_score_timing = $15,
            review_visibility = $16,
            review_when = $17,
            one_question_at_a_time = $18,
            shuffle_questions = $19,
            shuffle_choices = $20,
            allow_back_navigation = $21,
            quiz_access_code = $22,
            adaptive_difficulty = $23,
            adaptive_topic_balance = $24,
            adaptive_stop_rule = $25,
            random_question_pool_count = $26,
            updated_at = NOW()
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
    .bind(s.available_from)
    .bind(s.available_until)
    .bind(s.unlimited_attempts)
    .bind(s.max_attempts)
    .bind(&s.grade_attempt_policy)
    .bind(s.passing_score_percent)
    .bind(s.points_worth)
    .bind(&s.late_submission_policy)
    .bind(s.late_penalty_percent)
    .bind(s.time_limit_minutes)
    .bind(s.timer_pause_when_tab_hidden)
    .bind(s.per_question_time_limit_seconds)
    .bind(&s.show_score_timing)
    .bind(&s.review_visibility)
    .bind(&s.review_when)
    .bind(s.one_question_at_a_time)
    .bind(s.shuffle_questions)
    .bind(s.shuffle_choices)
    .bind(s.allow_back_navigation)
    .bind(s.quiz_access_code.as_deref())
    .bind(&s.adaptive_difficulty)
    .bind(s.adaptive_topic_balance)
    .bind(&s.adaptive_stop_rule)
    .bind(s.random_question_pool_count)
    .fetch_optional(pool)
    .await
}

pub async fn update_title(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    title: &str,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        WITH c_up AS (
            UPDATE {}
            SET title = $3, updated_at = NOW()
            WHERE id = $1 AND course_id = $2 AND kind = 'quiz'
            RETURNING id
        )
        UPDATE {} m
        SET updated_at = NOW()
        FROM c_up
        WHERE m.structure_item_id = c_up.id
        RETURNING m.updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::MODULE_QUIZZES
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(title)
    .fetch_optional(pool)
    .await
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

pub async fn update_adaptive_config(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    is_adaptive: bool,
    adaptive_system_prompt: &str,
    adaptive_source_item_ids: &[Uuid],
    adaptive_question_count: i32,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        UPDATE {} m
        SET is_adaptive = $3,
            adaptive_system_prompt = $4,
            adaptive_source_item_ids = $5::jsonb,
            adaptive_question_count = $6,
            updated_at = NOW()
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
    .bind(is_adaptive)
    .bind(adaptive_system_prompt)
    .bind(Json(adaptive_source_item_ids.to_vec()))
    .bind(adaptive_question_count)
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

pub async fn upsert_import_body(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    markdown: &str,
    questions: &[QuizQuestion],
    settings: &QuizSettingsWrite,
    is_adaptive: bool,
    adaptive_system_prompt: &str,
    adaptive_source_item_ids: &[Uuid],
    adaptive_question_count: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            structure_item_id, markdown, questions_json, updated_at,
            available_from, available_until, unlimited_attempts, max_attempts,
            grade_attempt_policy, passing_score_percent, points_worth, late_submission_policy, late_penalty_percent,
            time_limit_minutes, timer_pause_when_tab_hidden, per_question_time_limit_seconds,
            show_score_timing, review_visibility, review_when,
            one_question_at_a_time, shuffle_questions, shuffle_choices, allow_back_navigation,
            quiz_access_code, adaptive_difficulty, adaptive_topic_balance, adaptive_stop_rule,
            random_question_pool_count,
            is_adaptive, adaptive_system_prompt, adaptive_source_item_ids, adaptive_question_count
        )
        SELECT c.id, $3, $4::jsonb, NOW(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31::jsonb, $32
        FROM {} c
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'quiz'
        ON CONFLICT (structure_item_id) DO UPDATE SET
            markdown = EXCLUDED.markdown,
            questions_json = EXCLUDED.questions_json,
            updated_at = NOW(),
            available_from = EXCLUDED.available_from,
            available_until = EXCLUDED.available_until,
            unlimited_attempts = EXCLUDED.unlimited_attempts,
            max_attempts = EXCLUDED.max_attempts,
            grade_attempt_policy = EXCLUDED.grade_attempt_policy,
            passing_score_percent = EXCLUDED.passing_score_percent,
            points_worth = EXCLUDED.points_worth,
            late_submission_policy = EXCLUDED.late_submission_policy,
            late_penalty_percent = EXCLUDED.late_penalty_percent,
            time_limit_minutes = EXCLUDED.time_limit_minutes,
            timer_pause_when_tab_hidden = EXCLUDED.timer_pause_when_tab_hidden,
            per_question_time_limit_seconds = EXCLUDED.per_question_time_limit_seconds,
            show_score_timing = EXCLUDED.show_score_timing,
            review_visibility = EXCLUDED.review_visibility,
            review_when = EXCLUDED.review_when,
            one_question_at_a_time = EXCLUDED.one_question_at_a_time,
            shuffle_questions = EXCLUDED.shuffle_questions,
            shuffle_choices = EXCLUDED.shuffle_choices,
            allow_back_navigation = EXCLUDED.allow_back_navigation,
            quiz_access_code = EXCLUDED.quiz_access_code,
            adaptive_difficulty = EXCLUDED.adaptive_difficulty,
            adaptive_topic_balance = EXCLUDED.adaptive_topic_balance,
            adaptive_stop_rule = EXCLUDED.adaptive_stop_rule,
            random_question_pool_count = EXCLUDED.random_question_pool_count,
            is_adaptive = EXCLUDED.is_adaptive,
            adaptive_system_prompt = EXCLUDED.adaptive_system_prompt,
            adaptive_source_item_ids = EXCLUDED.adaptive_source_item_ids,
            adaptive_question_count = EXCLUDED.adaptive_question_count
        "#,
        schema::MODULE_QUIZZES,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(markdown)
    .bind(Json(questions.to_vec()))
    .bind(settings.available_from)
    .bind(settings.available_until)
    .bind(settings.unlimited_attempts)
    .bind(settings.max_attempts)
    .bind(&settings.grade_attempt_policy)
    .bind(settings.passing_score_percent)
    .bind(settings.points_worth)
    .bind(&settings.late_submission_policy)
    .bind(settings.late_penalty_percent)
    .bind(settings.time_limit_minutes)
    .bind(settings.timer_pause_when_tab_hidden)
    .bind(settings.per_question_time_limit_seconds)
    .bind(&settings.show_score_timing)
    .bind(&settings.review_visibility)
    .bind(&settings.review_when)
    .bind(settings.one_question_at_a_time)
    .bind(settings.shuffle_questions)
    .bind(settings.shuffle_choices)
    .bind(settings.allow_back_navigation)
    .bind(settings.quiz_access_code.as_deref())
    .bind(&settings.adaptive_difficulty)
    .bind(settings.adaptive_topic_balance)
    .bind(&settings.adaptive_stop_rule)
    .bind(settings.random_question_pool_count)
    .bind(is_adaptive)
    .bind(adaptive_system_prompt)
    .bind(Json(adaptive_source_item_ids.to_vec()))
    .bind(adaptive_question_count)
    .execute(pool)
    .await?;
    Ok(())
}

/// Quiz attempt record from database.
#[derive(Debug, Clone, FromRow)]
pub struct QuizAttemptRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub student_user_id: Uuid,
    pub quiz_item_id: Uuid,
    pub attempt_number: i32,
    pub started_at: DateTime<Utc>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub answers_json: Json<Vec<crate::models::course_module_quiz::QuizAnswer>>,
    pub time_spent_seconds: Option<i32>,
    pub score: Option<f64>,
    pub max_score: Option<f64>,
    pub updated_at: DateTime<Utc>,
}

/// Get the next attempt number for a student's quiz (returns 1 if no attempts yet).
pub async fn get_next_attempt_number(
    pool: &PgPool,
    student_user_id: Uuid,
    quiz_item_id: Uuid,
) -> Result<i32, sqlx::Error> {
    let result: (Option<i32>,) = sqlx::query_as(&format!(
        r#"
        SELECT MAX(attempt_number) FROM {}
        WHERE student_user_id = $1 AND quiz_item_id = $2
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(student_user_id)
    .bind(quiz_item_id)
    .fetch_one(pool)
    .await?;

    Ok(result.0.unwrap_or(0) + 1)
}

/// Insert a new quiz attempt (started but not yet submitted).
pub async fn insert_attempt(
    pool: &PgPool,
    course_id: Uuid,
    student_user_id: Uuid,
    quiz_item_id: Uuid,
    attempt_number: i32,
) -> Result<Uuid, sqlx::Error> {
    let attempt_id = Uuid::new_v4();
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (id, course_id, student_user_id, quiz_item_id, attempt_number, started_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(attempt_id)
    .bind(course_id)
    .bind(student_user_id)
    .bind(quiz_item_id)
    .bind(attempt_number)
    .execute(pool)
    .await?;

    Ok(attempt_id)
}

/// Submit a quiz attempt with answers and optionally update score.
pub async fn submit_attempt(
    pool: &PgPool,
    attempt_id: Uuid,
    student_user_id: Uuid,
    quiz_item_id: Uuid,
    answers: &[crate::models::course_module_quiz::QuizAnswer],
    time_spent_seconds: Option<i32>,
    score: Option<f64>,
    max_score: Option<f64>,
) -> Result<Option<QuizAttemptRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        UPDATE {}
        SET submitted_at = NOW(),
            answers_json = $4,
            time_spent_seconds = $5,
            score = $6,
            max_score = $7,
            updated_at = NOW()
        WHERE id = $1
          AND student_user_id = $2
          AND quiz_item_id = $3
        RETURNING *
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(attempt_id)
    .bind(student_user_id)
    .bind(quiz_item_id)
    .bind(Json(answers.to_vec()))
    .bind(time_spent_seconds)
    .bind(score)
    .bind(max_score)
    .fetch_optional(pool)
    .await
}

/// Get all submitted attempts for a student on a quiz, ordered by attempt number.
pub async fn get_student_attempts(
    pool: &PgPool,
    student_user_id: Uuid,
    quiz_item_id: Uuid,
) -> Result<Vec<QuizAttemptRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT * FROM {}
        WHERE student_user_id = $1 AND quiz_item_id = $2 AND submitted_at IS NOT NULL
        ORDER BY attempt_number ASC
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(student_user_id)
    .bind(quiz_item_id)
    .fetch_all(pool)
    .await
}

/// Get a specific quiz attempt by ID.
pub async fn get_attempt_by_id(
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<Option<QuizAttemptRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT * FROM {} WHERE id = $1
        "#,
        schema::QUIZ_ATTEMPTS
    ))
    .bind(attempt_id)
    .fetch_optional(pool)
    .await
}
