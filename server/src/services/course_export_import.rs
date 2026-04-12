use std::collections::{HashMap, HashSet};

use chrono::Utc;
use uuid::Uuid;

use crate::db::schema;
use crate::error::AppError;
use crate::models::course::{MarkdownThemeCustom, GRADING_SCALES};
use crate::models::course_export::{
    CourseExportSnapshot, CourseExportV1, CourseImportMode, ExportedAssignmentBody,
    ExportedContentPageBody, ExportedQuizBody,
};
use crate::models::course_grading::CourseGradingSettingsResponse;
use crate::models::course_module_quiz::{
    validate_adaptive_quiz_settings, validate_item_points_worth, validate_quiz_questions,
};
use crate::models::course_structure::CourseStructureItemResponse;
use crate::models::course_syllabus::SyllabusSection;
use crate::repos::course;
use crate::repos::course::UpdateCourse;
use crate::repos::course_grading;
use crate::repos::course_module_assignments;
use crate::repos::course_module_content;
use crate::repos::course_module_external_links;
use crate::repos::course_module_quizzes::{self, QuizSettingsWrite};
use crate::repos::course_structure;
use crate::repos::course_syllabus;
use sqlx::PgPool;

const EXPORT_FORMAT_VERSION: i32 = 1;

fn quiz_settings_from_export(body: &ExportedQuizBody) -> QuizSettingsWrite {
    QuizSettingsWrite {
        available_from: body.available_from,
        available_until: body.available_until,
        unlimited_attempts: body.unlimited_attempts,
        max_attempts: body.max_attempts,
        grade_attempt_policy: body.grade_attempt_policy.clone(),
        passing_score_percent: body.passing_score_percent,
        late_submission_policy: body.late_submission_policy.clone(),
        late_penalty_percent: body.late_penalty_percent,
        time_limit_minutes: body.time_limit_minutes,
        timer_pause_when_tab_hidden: body.timer_pause_when_tab_hidden,
        per_question_time_limit_seconds: body.per_question_time_limit_seconds,
        show_score_timing: body.show_score_timing.clone(),
        review_visibility: body.review_visibility.clone(),
        review_when: body.review_when.clone(),
        one_question_at_a_time: body.one_question_at_a_time,
        shuffle_questions: body.shuffle_questions,
        shuffle_choices: body.shuffle_choices,
        allow_back_navigation: body.allow_back_navigation,
        quiz_access_code: body.quiz_access_code.clone(),
        adaptive_difficulty: body.adaptive_difficulty.clone(),
        adaptive_topic_balance: body.adaptive_topic_balance,
        adaptive_stop_rule: body.adaptive_stop_rule.clone(),
        random_question_pool_count: body.random_question_pool_count,
        points_worth: body.points_worth,
    }
}
const MAX_SYLLABUS_SECTIONS: usize = 50;
const MAX_SYLLABUS_HEADING_LEN: usize = 512;
const MAX_SYLLABUS_MARKDOWN_LEN: usize = 200_000;
const MAX_MODULE_CONTENT_MARKDOWN_LEN: usize = 200_000;

fn validate_syllabus_sections(sections: &[SyllabusSection]) -> Result<(), AppError> {
    if sections.len() > MAX_SYLLABUS_SECTIONS {
        return Err(AppError::InvalidInput(format!(
            "Too many sections (max {MAX_SYLLABUS_SECTIONS})."
        )));
    }
    for s in sections {
        if s.id.trim().is_empty() {
            return Err(AppError::InvalidInput("Each section needs an id.".into()));
        }
        if s.heading.len() > MAX_SYLLABUS_HEADING_LEN {
            return Err(AppError::InvalidInput(
                "Section heading is too long.".into(),
            ));
        }
        if s.markdown.len() > MAX_SYLLABUS_MARKDOWN_LEN {
            return Err(AppError::InvalidInput(
                "Section content is too long.".into(),
            ));
        }
    }
    Ok(())
}

fn validate_structure_export(items: &[CourseStructureItemResponse]) -> Result<(), AppError> {
    let allowed = [
        "module",
        "heading",
        "content_page",
        "assignment",
        "quiz",
        "external_link",
    ];
    let mut seen: HashSet<Uuid> = HashSet::new();
    for it in items {
        if !allowed.contains(&it.kind.as_str()) {
            return Err(AppError::InvalidInput(format!(
                "Unsupported structure kind: {}.",
                it.kind
            )));
        }
        if let Some(pid) = it.parent_id {
            if !seen.contains(&pid) {
                return Err(AppError::InvalidInput(
                    "Structure items must be ordered so each parent appears before its children."
                        .into(),
                ));
            }
        } else if it.kind != "module" {
            return Err(AppError::InvalidInput(
                "Only modules may have a null parent.".into(),
            ));
        }
        if !seen.insert(it.id) {
            return Err(AppError::InvalidInput(
                "Duplicate structure item id.".into(),
            ));
        }
    }
    Ok(())
}

fn validate_export_payload(ex: &CourseExportV1) -> Result<(), AppError> {
    if ex.format_version != EXPORT_FORMAT_VERSION {
        return Err(AppError::InvalidInput(
            "Unsupported export formatVersion (expected 1).".into(),
        ));
    }
    if ex.course_code.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Export is missing courseCode.".into(),
        ));
    }
    // `courseCode` in the file records the source course; imports may target any course.
    if !GRADING_SCALES.contains(&ex.grading.grading_scale.as_str()) {
        return Err(AppError::InvalidInput(
            "Invalid grading scale in export.".into(),
        ));
    }
    for g in &ex.grading.assignment_groups {
        if g.name.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Each assignment group in the export needs a name.".into(),
            ));
        }
    }
    validate_syllabus_sections(&ex.syllabus)?;
    validate_structure_export(&ex.structure)?;
    for (id, body) in &ex.content_pages {
        if body.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
            return Err(AppError::InvalidInput(format!(
                "Content page {id} markdown is too long."
            )));
        }
    }
    for (id, body) in &ex.assignments {
        if body.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
            return Err(AppError::InvalidInput(format!(
                "Assignment {id} markdown is too long."
            )));
        }
        validate_item_points_worth(body.points_worth)?;
    }
    for (id, body) in &ex.quizzes {
        if body.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
            return Err(AppError::InvalidInput(format!(
                "Quiz {id} markdown is too long."
            )));
        }
        validate_quiz_questions(&body.questions)?;
        validate_item_points_worth(body.points_worth)?;
        if body.is_adaptive {
            validate_adaptive_quiz_settings(
                true,
                &body.adaptive_system_prompt,
                &body.adaptive_source_item_ids,
                body.adaptive_question_count,
            )?;
        }
    }
    for it in &ex.structure {
        if it.kind != "external_link" {
            continue;
        }
        if let Some(ref u) = it.external_url {
            let t = u.trim();
            if !t.is_empty() {
                course_module_external_links::validate_external_http_url(t)?;
            }
        }
    }
    Ok(())
}

async fn apply_course_snapshot(
    pool: &PgPool,
    course_code: &str,
    snap: &CourseExportSnapshot,
) -> Result<(), AppError> {
    let mode = snap.schedule_mode.trim();
    let mode = if mode == "relative" {
        "relative"
    } else {
        "fixed"
    };
    let (
        starts_at,
        ends_at,
        visible_from,
        hidden_at,
        schedule_mode,
        relative_end_after,
        relative_hidden_after,
        relative_schedule_anchor_at,
    ) = if mode == "relative" {
        let anchor_at = snap
            .relative_schedule_anchor_at
            .or(snap.starts_at)
            .unwrap_or_else(Utc::now);
        (
            None,
            None,
            None,
            None,
            "relative",
            snap.relative_end_after.as_deref(),
            snap.relative_hidden_after.as_deref(),
            Some(anchor_at),
        )
    } else {
        (
            snap.starts_at,
            snap.ends_at,
            snap.visible_from,
            snap.hidden_at,
            "fixed",
            None,
            None,
            None,
        )
    };
    let u = UpdateCourse {
        course_code,
        title: snap.title.trim(),
        description: snap.description.trim(),
        published: snap.published,
        starts_at,
        ends_at,
        visible_from,
        hidden_at,
        schedule_mode,
        relative_end_after,
        relative_hidden_after,
        relative_schedule_anchor_at,
    };
    course::update_course(pool, &u)
        .await?
        .ok_or(AppError::NotFound)?;
    let preset = snap.markdown_theme_preset.trim();
    let custom: Option<MarkdownThemeCustom> = snap
        .markdown_theme_custom
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    course::update_markdown_theme(pool, course_code, preset, custom.as_ref())
        .await?
        .ok_or(AppError::NotFound)?;
    let url = snap
        .hero_image_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let pos = snap
        .hero_image_object_position
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    course::update_hero_fields_optional(pool, course_code, url, pos)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

async fn apply_grading_from_export(
    pool: &PgPool,
    course_code: &str,
    grading: &CourseGradingSettingsResponse,
) -> Result<(), AppError> {
    // Imports (Canvas or JSON) carry assignment group UUIDs that do not exist on the target
    // course yet. `put_settings` only UPDATEs by id; use replace so groups are INSERTed with
    // the bundle ids before structure rows reference them.
    course_grading::replace_assignment_groups_for_import(
        pool,
        course_code,
        grading.grading_scale.trim(),
        &grading.assignment_groups,
    )
    .await?;
    Ok(())
}

async fn merge_add_grading_groups(
    pool: &PgPool,
    course_id: Uuid,
    grading: &CourseGradingSettingsResponse,
) -> Result<(), AppError> {
    for g in &grading.assignment_groups {
        let name = g.name.trim();
        if name.is_empty() {
            continue;
        }
        let w = g.weight_percent.clamp(0.0, 100.0);
        course_grading::insert_assignment_group_if_missing(
            pool,
            course_id,
            g.id,
            g.sort_order,
            name,
            w,
        )
        .await?;
    }
    Ok(())
}

async fn apply_module_bodies(
    pool: &PgPool,
    course_id: Uuid,
    ex: &CourseExportV1,
) -> Result<(), AppError> {
    for it in &ex.structure {
        match it.kind.as_str() {
            "content_page" => {
                if let Some(body) = ex.content_pages.get(&it.id) {
                    course_module_content::upsert_import_body(
                        pool,
                        course_id,
                        it.id,
                        &body.markdown,
                    )
                    .await?;
                    course_structure::set_content_page_due_at(pool, course_id, it.id, body.due_at)
                        .await
                        .map_err(|e| match e {
                            sqlx::Error::RowNotFound => AppError::InvalidInput(
                                "Content page due date update failed.".into(),
                            ),
                            _ => e.into(),
                        })?;
                }
            }
            "assignment" => {
                if let Some(body) = ex.assignments.get(&it.id) {
                    course_module_assignments::upsert_import_body(
                        pool,
                        course_id,
                        it.id,
                        &body.markdown,
                        body.points_worth,
                    )
                    .await?;
                    course_structure::set_assignment_due_at(pool, course_id, it.id, body.due_at)
                        .await
                        .map_err(|e| match e {
                            sqlx::Error::RowNotFound => {
                                AppError::InvalidInput("Assignment due date update failed.".into())
                            }
                            _ => e.into(),
                        })?;
                }
            }
            "quiz" => {
                if let Some(body) = ex.quizzes.get(&it.id) {
                    let settings = quiz_settings_from_export(body);
                    course_module_quizzes::upsert_import_body(
                        pool,
                        course_id,
                        it.id,
                        &body.markdown,
                        &body.questions,
                        &settings,
                        body.is_adaptive,
                        &body.adaptive_system_prompt,
                        &body.adaptive_source_item_ids,
                        body.adaptive_question_count,
                    )
                    .await?;
                    course_structure::set_quiz_due_at(pool, course_id, it.id, body.due_at)
                        .await
                        .map_err(|e| match e {
                            sqlx::Error::RowNotFound => {
                                AppError::InvalidInput("Quiz due date update failed.".into())
                            }
                            _ => e.into(),
                        })?;
                }
            }
            "external_link" => {
                let raw = it
                    .external_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("");
                let stored = if raw.is_empty() {
                    String::new()
                } else {
                    course_module_external_links::validate_external_http_url(raw)?
                };
                course_module_external_links::upsert_import_body(pool, course_id, it.id, &stored)
                    .await?;
            }
            _ => {}
        }
    }
    Ok(())
}

async fn apply_module_bodies_for_new_items_only(
    pool: &PgPool,
    course_id: Uuid,
    ex: &CourseExportV1,
    inserted: &HashSet<Uuid>,
) -> Result<(), AppError> {
    for it in &ex.structure {
        if !inserted.contains(&it.id) {
            continue;
        }
        match it.kind.as_str() {
            "content_page" => {
                if let Some(body) = ex.content_pages.get(&it.id) {
                    course_module_content::upsert_import_body(
                        pool,
                        course_id,
                        it.id,
                        &body.markdown,
                    )
                    .await?;
                    course_structure::set_content_page_due_at(pool, course_id, it.id, body.due_at)
                        .await
                        .map_err(AppError::from)?;
                }
            }
            "assignment" => {
                if let Some(body) = ex.assignments.get(&it.id) {
                    course_module_assignments::upsert_import_body(
                        pool,
                        course_id,
                        it.id,
                        &body.markdown,
                        body.points_worth,
                    )
                    .await?;
                    course_structure::set_assignment_due_at(pool, course_id, it.id, body.due_at)
                        .await
                        .map_err(AppError::from)?;
                }
            }
            "quiz" => {
                if let Some(body) = ex.quizzes.get(&it.id) {
                    let settings = quiz_settings_from_export(body);
                    course_module_quizzes::upsert_import_body(
                        pool,
                        course_id,
                        it.id,
                        &body.markdown,
                        &body.questions,
                        &settings,
                        body.is_adaptive,
                        &body.adaptive_system_prompt,
                        &body.adaptive_source_item_ids,
                        body.adaptive_question_count,
                    )
                    .await?;
                    course_structure::set_quiz_due_at(pool, course_id, it.id, body.due_at)
                        .await
                        .map_err(AppError::from)?;
                }
            }
            "external_link" => {
                let raw = it
                    .external_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("");
                let stored = if raw.is_empty() {
                    String::new()
                } else {
                    course_module_external_links::validate_external_http_url(raw)?
                };
                course_module_external_links::upsert_import_body(pool, course_id, it.id, &stored)
                    .await?;
            }
            _ => {}
        }
    }
    Ok(())
}

async fn delete_structure_not_in_export(
    pool: &PgPool,
    course_id: Uuid,
    keep: &HashSet<Uuid>,
) -> Result<(), AppError> {
    if keep.is_empty() {
        course_structure::delete_all_items_for_course(pool, course_id)
            .await
            .map_err(AppError::from)?;
        return Ok(());
    }
    let ids: Vec<Uuid> = keep.iter().copied().collect();
    sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE course_id = $1
          AND parent_id IS NOT NULL
          AND NOT (id = ANY($2::uuid[]))
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(&ids)
    .execute(pool)
    .await?;
    sqlx::query(&format!(
        r#"
        DELETE FROM {}
        WHERE course_id = $1
          AND parent_id IS NULL
          AND NOT (id = ANY($2::uuid[]))
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(&ids)
    .execute(pool)
    .await?;
    Ok(())
}

async fn merge_syllabus_sections(
    pool: &PgPool,
    course_id: Uuid,
    incoming: &[SyllabusSection],
) -> Result<(), AppError> {
    let current = course_syllabus::get_sections(pool, course_id)
        .await?
        .map(|(s, _)| s)
        .unwrap_or_default();
    let mut seen: HashSet<String> = current.iter().map(|s| s.id.clone()).collect();
    let mut out = current;
    for s in incoming {
        if !seen.contains(&s.id) {
            seen.insert(s.id.clone());
            out.push(s.clone());
        }
    }
    if out.len() > MAX_SYLLABUS_SECTIONS {
        return Err(AppError::InvalidInput(format!(
            "Too many syllabus sections after merge (max {MAX_SYLLABUS_SECTIONS})."
        )));
    }
    validate_syllabus_sections(&out)?;
    course_syllabus::upsert_sections(pool, course_id, &out).await?;
    Ok(())
}

pub async fn build_export(pool: &PgPool, course_code: &str) -> Result<CourseExportV1, AppError> {
    let course = course::get_by_course_code(pool, course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    let course_id = course.id;

    let snap = CourseExportSnapshot {
        title: course.title.clone(),
        description: course.description.clone(),
        hero_image_url: course.hero_image_url.clone(),
        hero_image_object_position: course.hero_image_object_position.clone(),
        starts_at: course.starts_at,
        ends_at: course.ends_at,
        visible_from: course.visible_from,
        hidden_at: course.hidden_at,
        schedule_mode: course.schedule_mode.clone(),
        relative_end_after: course.relative_end_after.clone(),
        relative_hidden_after: course.relative_hidden_after.clone(),
        relative_schedule_anchor_at: course.relative_schedule_anchor_at,
        published: course.published,
        markdown_theme_preset: course.markdown_theme_preset.clone(),
        markdown_theme_custom: course.markdown_theme_custom.clone(),
    };

    let grading = course_grading::get_settings_for_course_code(pool, course_code)
        .await?
        .ok_or(AppError::NotFound)?;

    let (syllabus, require_syllabus_acceptance) =
        match course_syllabus::get_for_course(pool, course_id).await? {
            Some((s, _, r)) => (s, r),
            None => (Vec::new(), false),
        };

    let structure_rows = course_structure::list_for_course(pool, course_id).await?;
    let structure =
        course_structure::rows_to_responses_with_quiz_adaptive(pool, course_id, structure_rows)
            .await?;

    let mut content_pages: HashMap<Uuid, ExportedContentPageBody> = HashMap::new();
    let mut assignments: HashMap<Uuid, ExportedAssignmentBody> = HashMap::new();
    let mut quizzes: HashMap<Uuid, ExportedQuizBody> = HashMap::new();

    for it in &structure {
        match it.kind.as_str() {
            "content_page" => {
                if let Some((title, markdown, due_at, _)) =
                    course_module_content::get_for_course_item(pool, course_id, it.id).await?
                {
                    let _ = title;
                    content_pages.insert(it.id, ExportedContentPageBody { markdown, due_at });
                }
            }
            "assignment" => {
                if let Some((title, markdown, due_at, points_worth, _, _)) =
                    course_module_assignments::get_for_course_item(pool, course_id, it.id).await?
                {
                    let _ = title;
                    assignments.insert(
                        it.id,
                        ExportedAssignmentBody {
                            markdown,
                            due_at,
                            points_worth,
                        },
                    );
                }
            }
            "quiz" => {
                if let Some(row) =
                    course_module_quizzes::get_for_course_item(pool, course_id, it.id).await?
                {
                    let _ = row.title;
                    quizzes.insert(
                        it.id,
                        ExportedQuizBody {
                            markdown: row.markdown,
                            due_at: row.due_at,
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
                            questions: row.questions_json.0,
                            is_adaptive: row.is_adaptive,
                            adaptive_system_prompt: row.adaptive_system_prompt,
                            adaptive_source_item_ids: row.adaptive_source_item_ids.0,
                            adaptive_question_count: row.adaptive_question_count,
                        },
                    );
                }
            }
            _ => {}
        }
    }

    Ok(CourseExportV1 {
        format_version: EXPORT_FORMAT_VERSION,
        exported_at: Utc::now(),
        course_code: course.course_code.clone(),
        course: snap,
        syllabus,
        require_syllabus_acceptance,
        grading,
        structure,
        content_pages,
        assignments,
        quizzes,
    })
}

pub async fn apply_import(
    pool: &PgPool,
    target_course_code: &str,
    mode: CourseImportMode,
    ex: &CourseExportV1,
) -> Result<(), AppError> {
    validate_export_payload(ex)?;

    let course_id = course::get_id_by_course_code(pool, target_course_code)
        .await?
        .ok_or(AppError::NotFound)?;

    match mode {
        CourseImportMode::Erase => {
            course_structure::delete_all_items_for_course(pool, course_id)
                .await
                .map_err(AppError::from)?;
            apply_grading_from_export(pool, target_course_code, &ex.grading).await?;
            apply_course_snapshot(pool, target_course_code, &ex.course).await?;
            course_syllabus::upsert_syllabus(
                pool,
                course_id,
                &ex.syllabus,
                ex.require_syllabus_acceptance,
            )
            .await
            .map_err(AppError::from)?;
            for it in &ex.structure {
                course_structure::import_upsert_structure_item(pool, course_id, it, false)
                    .await
                    .map_err(AppError::from)?;
            }
            apply_module_bodies(pool, course_id, ex).await?;
        }
        CourseImportMode::MergeAdd => {
            merge_add_grading_groups(pool, course_id, &ex.grading).await?;
            merge_syllabus_sections(pool, course_id, &ex.syllabus).await?;
            let mut inserted: HashSet<Uuid> = HashSet::new();
            for it in &ex.structure {
                let ins = course_structure::import_upsert_structure_item(pool, course_id, it, true)
                    .await
                    .map_err(AppError::from)?;
                if ins {
                    inserted.insert(it.id);
                }
            }
            apply_module_bodies_for_new_items_only(pool, course_id, ex, &inserted).await?;
        }
        CourseImportMode::Overwrite => {
            apply_grading_from_export(pool, target_course_code, &ex.grading).await?;
            apply_course_snapshot(pool, target_course_code, &ex.course).await?;
            course_syllabus::upsert_syllabus(
                pool,
                course_id,
                &ex.syllabus,
                ex.require_syllabus_acceptance,
            )
            .await
            .map_err(AppError::from)?;
            let keep: HashSet<Uuid> = ex.structure.iter().map(|i| i.id).collect();
            delete_structure_not_in_export(pool, course_id, &keep).await?;
            for it in &ex.structure {
                course_structure::import_upsert_structure_item(pool, course_id, it, false)
                    .await
                    .map_err(AppError::from)?;
            }
            apply_module_bodies(pool, course_id, ex).await?;
        }
    }

    Ok(())
}
