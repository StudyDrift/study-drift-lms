use std::collections::{HashMap, HashSet};

use chrono::Utc;
use uuid::Uuid;

use crate::db::schema;
use crate::error::AppError;
use crate::models::course::{MarkdownThemeCustom, GRADING_SCALES};
use crate::models::course_export::{
    CanvasImportInclude, CourseExportSnapshot, CourseExportV1, CourseImportMode,
    ExportedAssignmentBody, ExportedContentPageBody, ExportedCourseEnrollment, ExportedQuizBody,
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
use crate::repos::course_grants;
use crate::repos::course_module_assignments;
use crate::repos::course_module_content;
use crate::repos::course_module_external_links;
use crate::repos::course_module_quizzes::{self, QuizSettingsWrite};
use crate::repos::course_structure;
use crate::repos::course_syllabus;
use crate::repos::enrollment;
use crate::repos::rbac;
use crate::repos::user;
use crate::services::auth;
use sqlx::PgPool;

const EXPORT_FORMAT_VERSION: i32 = 1;
const MAX_EXPORT_ENROLLMENTS: usize = 5000;
const MAX_ENROLLMENT_EMAIL_LEN: usize = 320;
const MAX_ENROLLMENT_DISPLAY_NAME_LEN: usize = 256;

fn normalize_enrollment_email(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn validate_export_enrollments(rows: &[ExportedCourseEnrollment]) -> Result<(), AppError> {
    if rows.len() > MAX_EXPORT_ENROLLMENTS {
        return Err(AppError::invalid_input(format!(
            "Too many enrollments in export (max {MAX_EXPORT_ENROLLMENTS})."
        )));
    }
    for row in rows {
        let e = normalize_enrollment_email(&row.email);
        if e.is_empty() || !e.contains('@') || e.len() > MAX_ENROLLMENT_EMAIL_LEN {
            return Err(AppError::invalid_input(
                "Each enrollment needs a valid email address.",
            ));
        }
        let role = row.role.trim();
        if role != "student" && role != "instructor" && role != "teacher" {
            return Err(AppError::invalid_input(format!(
                "Invalid enrollment role `{role}` (expected student, instructor, or teacher)."
            )));
        }
        if let Some(ref g) = row.instructor_grant_role {
            let g = g.trim();
            if g != "Teacher" && g != "TA" {
                return Err(AppError::invalid_input(
                    "instructorGrantRole must be Teacher or TA when set.",
                ));
            }
            if role != "instructor" {
                return Err(AppError::invalid_input(
                    "instructorGrantRole may only be set when role is instructor.",
                ));
            }
        }
        if let Some(ref d) = row.display_name {
            if d.len() > MAX_ENROLLMENT_DISPLAY_NAME_LEN {
                return Err(AppError::invalid_input(format!(
                    "Enrollment display name is too long (max {MAX_ENROLLMENT_DISPLAY_NAME_LEN})."
                )));
            }
        }
    }
    Ok(())
}

async fn apply_course_staff_grants_from_catalog(
    pool: &PgPool,
    course_code: &str,
    course_id: Uuid,
    user_id: Uuid,
    catalog_role_name: &str,
) -> Result<(), AppError> {
    let Some(role_id) = rbac::app_role_id_by_name(pool, catalog_role_name)
        .await
        .map_err(AppError::from)?
    else {
        return Err(AppError::invalid_input(format!(
            "Missing RBAC catalog role `{catalog_role_name}`."
        )));
    };
    course_grants::apply_app_role_course_grants(pool, user_id, course_id, course_code, role_id)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

async fn apply_one_enrollment_from_export(
    pool: &PgPool,
    course_code: &str,
    course_id: Uuid,
    creator_user_id: Uuid,
    row: &ExportedCourseEnrollment,
    placeholder_password_hash: &str,
) -> Result<(), AppError> {
    let email = normalize_enrollment_email(&row.email);
    let display_name = row
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let (u, created_user) =
        user::find_or_create_user_for_import(pool, &email, display_name, placeholder_password_hash)
            .await
            .map_err(AppError::from)?;
    if created_user {
        rbac::assign_user_role_by_name(pool, u.id, "Student")
            .await
            .map_err(AppError::from)?;
    }

    let role = row.role.trim();
    let is_creator = u.id == creator_user_id;

    if enrollment::user_is_course_creator(pool, course_code, u.id).await?
        && (role == "student" || role == "instructor")
    {
        // Match roster API: do not add secondary student/instructor rows for the course creator.
        return Ok(());
    }

    match role {
        "student" => {
            enrollment::insert_student_if_missing(pool, course_id, u.id)
                .await
                .map_err(AppError::from)?;
        }
        "instructor" => {
            enrollment::upsert_instructor_enrollment(pool, course_code, course_id, u.id)
                .await
                .map_err(AppError::from)?;
            let grant_as = row
                .instructor_grant_role
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("TA");
            apply_course_staff_grants_from_catalog(pool, course_code, course_id, u.id, grant_as)
                .await?;
        }
        "teacher" => {
            if is_creator {
                enrollment::ensure_teacher_enrollment(pool, course_id, u.id)
                    .await
                    .map_err(AppError::from)?;
                apply_course_staff_grants_from_catalog(
                    pool,
                    course_code,
                    course_id,
                    u.id,
                    "Teacher",
                )
                .await?;
            } else {
                enrollment::upsert_instructor_enrollment(pool, course_code, course_id, u.id)
                    .await
                    .map_err(AppError::from)?;
                apply_course_staff_grants_from_catalog(
                    pool,
                    course_code,
                    course_id,
                    u.id,
                    "Teacher",
                )
                .await?;
            }
        }
        _ => {}
    }
    Ok(())
}

async fn apply_enrollments_from_export(
    pool: &PgPool,
    target_course_code: &str,
    course_id: Uuid,
    mode: CourseImportMode,
    rows: &[ExportedCourseEnrollment],
) -> Result<(), AppError> {
    if rows.is_empty() {
        return Ok(());
    }
    let Some(creator_user_id) = course::get_created_by_user_id(pool, target_course_code)
        .await
        .map_err(AppError::from)?
    else {
        return Err(AppError::invalid_input(
            "Course is missing a creator; cannot apply enrollments.",
        ));
    };

    let placeholder_password_hash = auth::hash_placeholder_password()?;

    match mode {
        CourseImportMode::Erase | CourseImportMode::Overwrite => {
            enrollment::delete_enrollments_except_creator_teacher(pool, course_id, creator_user_id)
                .await
                .map_err(AppError::from)?;
            for row in rows {
                apply_one_enrollment_from_export(
                    pool,
                    target_course_code,
                    course_id,
                    creator_user_id,
                    row,
                    &placeholder_password_hash,
                )
                .await?;
            }
        }
        CourseImportMode::MergeAdd => {
            for row in rows {
                apply_one_enrollment_from_export(
                    pool,
                    target_course_code,
                    course_id,
                    creator_user_id,
                    row,
                    &placeholder_password_hash,
                )
                .await?;
            }
        }
    }
    Ok(())
}

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
        adaptive_delivery_mode: body.adaptive_delivery_mode.clone(),
        points_worth: body.points_worth,
        lockdown_mode: crate::services::quiz_lockdown::parse_lockdown_mode_setting(
            &body.lockdown_mode,
        )
        .unwrap_or(crate::services::quiz_lockdown::LOCKDOWN_STANDARD)
        .to_string(),
        focus_loss_threshold: body.focus_loss_threshold,
    }
}
const MAX_SYLLABUS_SECTIONS: usize = 50;
const MAX_SYLLABUS_HEADING_LEN: usize = 512;
const MAX_SYLLABUS_MARKDOWN_LEN: usize = 200_000;
const MAX_MODULE_CONTENT_MARKDOWN_LEN: usize = 200_000;

fn validate_syllabus_sections(sections: &[SyllabusSection]) -> Result<(), AppError> {
    if sections.len() > MAX_SYLLABUS_SECTIONS {
        return Err(AppError::invalid_input(format!(
            "Too many sections (max {MAX_SYLLABUS_SECTIONS})."
        )));
    }
    for s in sections {
        if s.id.trim().is_empty() {
            return Err(AppError::invalid_input("Each section needs an id."));
        }
        if s.heading.len() > MAX_SYLLABUS_HEADING_LEN {
            return Err(AppError::invalid_input("Section heading is too long."));
        }
        if s.markdown.len() > MAX_SYLLABUS_MARKDOWN_LEN {
            return Err(AppError::invalid_input("Section content is too long."));
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
            return Err(AppError::invalid_input(format!(
                "Unsupported structure kind: {}.",
                it.kind
            )));
        }
        if let Some(pid) = it.parent_id {
            if !seen.contains(&pid) {
                return Err(AppError::invalid_input(
                    "Structure items must be ordered so each parent appears before its children.",
                ));
            }
        } else if it.kind != "module" {
            return Err(AppError::invalid_input(
                "Only modules may have a null parent.",
            ));
        }
        if !seen.insert(it.id) {
            return Err(AppError::invalid_input("Duplicate structure item id."));
        }
    }
    Ok(())
}

fn validate_export_payload(ex: &CourseExportV1) -> Result<(), AppError> {
    if ex.format_version != EXPORT_FORMAT_VERSION {
        return Err(AppError::invalid_input(
            "Unsupported export formatVersion (expected 1).",
        ));
    }
    if ex.course_code.trim().is_empty() {
        return Err(AppError::invalid_input("Export is missing courseCode."));
    }
    // `courseCode` in the file records the source course; imports may target any course.
    if !GRADING_SCALES.contains(&ex.grading.grading_scale.as_str()) {
        return Err(AppError::invalid_input("Invalid grading scale in export."));
    }
    for g in &ex.grading.assignment_groups {
        if g.name.trim().is_empty() {
            return Err(AppError::invalid_input(
                "Each assignment group in the export needs a name.",
            ));
        }
    }
    validate_syllabus_sections(&ex.syllabus)?;
    validate_structure_export(&ex.structure)?;
    for (id, body) in &ex.content_pages {
        if body.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
            return Err(AppError::invalid_input(format!(
                "Content page {id} markdown is too long."
            )));
        }
    }
    for (id, body) in &ex.assignments {
        if body.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
            return Err(AppError::invalid_input(format!(
                "Assignment {id} markdown is too long."
            )));
        }
        validate_item_points_worth(body.points_worth)?;
    }
    for (id, body) in &ex.quizzes {
        if body.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
            return Err(AppError::invalid_input(format!(
                "Quiz {id} markdown is too long."
            )));
        }
        validate_quiz_questions(&body.questions)?;
        validate_item_points_worth(body.points_worth)?;
        if body.is_adaptive {
            validate_adaptive_quiz_settings(
                true,
                &body.adaptive_delivery_mode,
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
    validate_export_enrollments(&ex.enrollments)?;
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
    course::patch_course_features(
        pool,
        course_code,
        snap.notebook_enabled,
        snap.feed_enabled,
        snap.calendar_enabled,
        snap.question_bank_enabled,
        snap.lockdown_mode_enabled,
        snap.standards_alignment_enabled,
        snap.adaptive_paths_enabled,
        snap.srs_enabled,
        snap.diagnostic_assessments_enabled,
        snap.hint_scaffolding_enabled,
        snap.misconception_detection_enabled,
    )
    .await?
    .ok_or(AppError::NotFound)?;
    course::set_course_type(pool, course_code, snap.course_type.trim())
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
                            sqlx::Error::RowNotFound => {
                                AppError::invalid_input("Content page due date update failed.")
                            }
                            _ => e.into(),
                        })?;
                }
            }
            "assignment" => {
                if let Some(body) = ex.assignments.get(&it.id) {
                    let rubric_json = match &body.rubric {
                        None => None,
                        Some(v) => {
                            let r: crate::models::assignment_rubric::RubricDefinition =
                                serde_json::from_value(v.clone()).map_err(|_| {
                                    AppError::invalid_input("Invalid rubric in course export.")
                                })?;
                            crate::models::assignment_rubric::validate_rubric_definition(&r)?;
                            crate::models::assignment_rubric::validate_rubric_against_points_worth(
                                &r,
                                body.points_worth,
                            )?;
                            Some(v.clone())
                        }
                    };
                    course_module_assignments::upsert_import_body(
                        pool,
                        course_id,
                        it.id,
                        &body.markdown,
                        body.points_worth,
                        body.available_from,
                        body.available_until,
                        body.assignment_access_code.as_deref(),
                        body.submission_allow_text,
                        body.submission_allow_file_upload,
                        body.submission_allow_url,
                        body.late_submission_policy.as_str(),
                        body.late_penalty_percent,
                        rubric_json.as_ref(),
                    )
                    .await?;
                    course_structure::set_assignment_due_at(pool, course_id, it.id, body.due_at)
                        .await
                        .map_err(|e| match e {
                            sqlx::Error::RowNotFound => {
                                AppError::invalid_input("Assignment due date update failed.")
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
                                AppError::invalid_input("Quiz due date update failed.")
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
                    let rubric_json = match &body.rubric {
                        None => None,
                        Some(v) => {
                            let r: crate::models::assignment_rubric::RubricDefinition =
                                serde_json::from_value(v.clone()).map_err(|_| {
                                    AppError::invalid_input("Invalid rubric in course export.")
                                })?;
                            crate::models::assignment_rubric::validate_rubric_definition(&r)?;
                            crate::models::assignment_rubric::validate_rubric_against_points_worth(
                                &r,
                                body.points_worth,
                            )?;
                            Some(v.clone())
                        }
                    };
                    course_module_assignments::upsert_import_body(
                        pool,
                        course_id,
                        it.id,
                        &body.markdown,
                        body.points_worth,
                        body.available_from,
                        body.available_until,
                        body.assignment_access_code.as_deref(),
                        body.submission_allow_text,
                        body.submission_allow_file_upload,
                        body.submission_allow_url,
                        body.late_submission_policy.as_str(),
                        body.late_penalty_percent,
                        rubric_json.as_ref(),
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
        return Err(AppError::invalid_input(format!(
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
        notebook_enabled: course.notebook_enabled,
        feed_enabled: course.feed_enabled,
        calendar_enabled: course.calendar_enabled,
        question_bank_enabled: course.question_bank_enabled,
        lockdown_mode_enabled: course.lockdown_mode_enabled,
        standards_alignment_enabled: course.standards_alignment_enabled,
        adaptive_paths_enabled: course.adaptive_paths_enabled,
        srs_enabled: course.srs_enabled,
        diagnostic_assessments_enabled: course.diagnostic_assessments_enabled,
        hint_scaffolding_enabled: course.hint_scaffolding_enabled,
        misconception_detection_enabled: course.misconception_detection_enabled,
        course_type: course.course_type.clone(),
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
                if let Some(row) =
                    course_module_assignments::get_for_course_item(pool, course_id, it.id).await?
                {
                    assignments.insert(
                        it.id,
                        ExportedAssignmentBody {
                            markdown: row.markdown,
                            due_at: row.due_at,
                            points_worth: row.points_worth,
                            available_from: row.available_from,
                            available_until: row.available_until,
                            assignment_access_code: row.assignment_access_code.clone(),
                            submission_allow_text: row.submission_allow_text,
                            submission_allow_file_upload: row.submission_allow_file_upload,
                            submission_allow_url: row.submission_allow_url,
                            late_submission_policy: row.late_submission_policy.clone(),
                            late_penalty_percent: row.late_penalty_percent,
                            rubric: row.rubric_json.clone(),
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
                            lockdown_mode: row.lockdown_mode.clone(),
                            focus_loss_threshold: row.focus_loss_threshold,
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
                            adaptive_delivery_mode: row.adaptive_delivery_mode.clone(),
                        },
                    );
                }
            }
            _ => {}
        }
    }

    let email_roles = enrollment::list_email_roles_for_course_export(pool, course_code).await?;
    let enrollments: Vec<ExportedCourseEnrollment> = email_roles
        .into_iter()
        .map(|(email, role, display_name)| ExportedCourseEnrollment {
            email,
            role,
            instructor_grant_role: None,
            display_name,
        })
        .collect();

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
        enrollments,
    })
}

pub async fn apply_import(
    pool: &PgPool,
    target_course_code: &str,
    mode: CourseImportMode,
    ex: &CourseExportV1,
    canvas_include: Option<&CanvasImportInclude>,
) -> Result<(), AppError> {
    validate_export_payload(ex)?;

    let course_id = course::get_id_by_course_code(pool, target_course_code)
        .await?
        .ok_or(AppError::NotFound)?;

    let apply_grades = canvas_include.map(|i| i.grades).unwrap_or(true);
    let apply_settings = canvas_include.map(|i| i.settings).unwrap_or(true);
    let apply_enrollments = canvas_include.map(|i| i.enrollments).unwrap_or(true);
    // JSON imports (`canvas_include` is None) erase the outline even when the bundle has no
    // structure rows. Canvas partial imports skip that when every content category was unchecked.
    let erase_outline_before_apply = !ex.structure.is_empty() || canvas_include.is_none();
    // When the Canvas export intentionally omits all modules (partial import), do not delete
    // local items that are absent from an empty `structure` list.
    let overwrite_prune_structure = !ex.structure.is_empty() || canvas_include.is_none();

    match mode {
        CourseImportMode::Erase => {
            if erase_outline_before_apply {
                course_structure::delete_all_items_for_course(pool, course_id)
                    .await
                    .map_err(AppError::from)?;
            }
            if apply_grades {
                apply_grading_from_export(pool, target_course_code, &ex.grading).await?;
            }
            if apply_settings {
                apply_course_snapshot(pool, target_course_code, &ex.course).await?;
                course_syllabus::upsert_syllabus(
                    pool,
                    course_id,
                    &ex.syllabus,
                    ex.require_syllabus_acceptance,
                )
                .await
                .map_err(AppError::from)?;
            }
            for it in &ex.structure {
                course_structure::import_upsert_structure_item(pool, course_id, it, false)
                    .await
                    .map_err(AppError::from)?;
            }
            apply_module_bodies(pool, course_id, ex).await?;
        }
        CourseImportMode::MergeAdd => {
            if apply_grades {
                merge_add_grading_groups(pool, course_id, &ex.grading).await?;
            }
            if apply_settings {
                merge_syllabus_sections(pool, course_id, &ex.syllabus).await?;
            }
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
            if apply_grades {
                apply_grading_from_export(pool, target_course_code, &ex.grading).await?;
            }
            if apply_settings {
                apply_course_snapshot(pool, target_course_code, &ex.course).await?;
                course_syllabus::upsert_syllabus(
                    pool,
                    course_id,
                    &ex.syllabus,
                    ex.require_syllabus_acceptance,
                )
                .await
                .map_err(AppError::from)?;
            }
            if overwrite_prune_structure {
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
    }

    let enrollment_rows: &[ExportedCourseEnrollment] = if apply_enrollments {
        &ex.enrollments
    } else {
        &[]
    };
    apply_enrollments_from_export(pool, target_course_code, course_id, mode, enrollment_rows)
        .await?;

    Ok(())
}
