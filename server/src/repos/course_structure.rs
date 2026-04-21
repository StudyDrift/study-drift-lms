use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_structure::{CourseStructureItemResponse, CourseStructureItemRow};
use crate::repos::course_module_assignments;
use crate::repos::course_module_content;
use crate::repos::course_module_external_links;
use crate::repos::course_module_quizzes;
use crate::repos::course_module_surveys;
use crate::services::competency_gating;
use crate::services::relative_schedule::{self, RelativeShiftContext};

/// Counts how many of `ids` exist in this course with `kind` in `kinds`.
pub async fn count_structure_items_with_kinds(
    pool: &PgPool,
    course_id: Uuid,
    ids: &[Uuid],
    kinds: &[&str],
) -> Result<i64, sqlx::Error> {
    if ids.is_empty() {
        return Ok(0);
    }
    sqlx::query_scalar(&format!(
        r#"
        SELECT COUNT(*)::bigint
        FROM {}
        WHERE course_id = $1
          AND id = ANY($2)
          AND kind = ANY($3)
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(ids)
    .bind(kinds)
    .fetch_one(pool)
    .await
}

pub async fn get_item_row(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CourseStructureItemRow>, sqlx::Error> {
    sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        SELECT id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        FROM {}
        WHERE id = $1 AND course_id = $2
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<CourseStructureItemRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        SELECT id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        FROM {}
        WHERE course_id = $1
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await?;

    Ok(order_structure_rows(rows))
}

/// Maps structure rows to API responses, including `is_adaptive` for quiz items.
pub async fn rows_to_responses_with_quiz_adaptive(
    pool: &PgPool,
    course_id: Uuid,
    rows: Vec<CourseStructureItemRow>,
) -> Result<Vec<CourseStructureItemResponse>, sqlx::Error> {
    let quiz_ids: Vec<Uuid> = rows
        .iter()
        .filter(|r| r.kind == "quiz")
        .map(|r| r.id)
        .collect();
    let assignment_ids: Vec<Uuid> = rows
        .iter()
        .filter(|r| r.kind == "assignment")
        .map(|r| r.id)
        .collect();
    let external_link_ids: Vec<Uuid> = rows
        .iter()
        .filter(|r| r.kind == "external_link")
        .map(|r| r.id)
        .collect();
    let outlines =
        course_module_quizzes::quiz_outline_for_structure_items(pool, course_id, &quiz_ids).await?;
    let assignment_points = course_module_assignments::points_worth_for_structure_items(
        pool,
        course_id,
        &assignment_ids,
    )
    .await?;
    let external_urls =
        course_module_external_links::urls_for_structure_items(pool, course_id, &external_link_ids)
            .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let mut item: CourseStructureItemResponse = row.into();
            if item.kind == "quiz" {
                if let Some(o) = outlines.get(&item.id) {
                    item.is_adaptive = Some(o.is_adaptive);
                    item.points_worth = o.points_worth;
                    if !o.is_adaptive {
                        item.points_possible = Some(o.question_points_total);
                    }
                } else {
                    item.is_adaptive = Some(false);
                    item.points_possible = Some(0);
                }
            }
            if item.kind == "assignment" {
                item.points_worth = assignment_points.get(&item.id).copied().flatten();
            }
            if item.kind == "external_link" {
                if let Some(u) = external_urls.get(&item.id) {
                    if !u.is_empty() {
                        item.external_url = Some(u.clone());
                    }
                }
            }
            item
        })
        .collect())
}

pub async fn row_to_response_with_quiz_adaptive(
    pool: &PgPool,
    course_id: Uuid,
    row: CourseStructureItemRow,
) -> Result<CourseStructureItemResponse, sqlx::Error> {
    let mut items = rows_to_responses_with_quiz_adaptive(pool, course_id, vec![row]).await?;
    items.pop().ok_or(sqlx::Error::RowNotFound)
}

/// Top-level items by `sort_order`, then each module's child headings in order.
pub fn order_structure_rows(rows: Vec<CourseStructureItemRow>) -> Vec<CourseStructureItemRow> {
    let mut top: Vec<_> = rows
        .iter()
        .filter(|r| r.parent_id.is_none())
        .cloned()
        .collect();
    top.sort_by_key(|r| r.sort_order);

    let mut out = Vec::with_capacity(rows.len());
    for row in top {
        let is_module = row.kind == "module";
        let id = row.id;
        out.push(row);
        if is_module {
            let mut children: Vec<_> = rows
                .iter()
                .filter(|r| r.parent_id == Some(id))
                .cloned()
                .collect();
            children.sort_by_key(|r| r.sort_order);
            out.extend(children);
        }
    }
    out
}

/// Leaf items a learner can open in outline order (modules and headings omitted).
pub fn navigable_kind(kind: &str) -> bool {
    matches!(
        kind,
        "content_page" | "assignment" | "quiz" | "external_link" | "survey" | "lti_link"
    )
}

pub fn navigable_ids_in_outline_order(rows: Vec<CourseStructureItemRow>) -> Vec<Uuid> {
    order_structure_rows(rows)
        .into_iter()
        .filter(|r| navigable_kind(&r.kind))
        .map(|r| r.id)
        .collect()
}

/// First navigable child under a module, if any.
pub fn first_navigable_child_id(module_id: Uuid, rows: &[CourseStructureItemRow]) -> Option<Uuid> {
    let mut children: Vec<_> = rows
        .iter()
        .filter(|r| r.parent_id == Some(module_id))
        .cloned()
        .collect();
    children.sort_by_key(|r| r.sort_order);
    children
        .into_iter()
        .find(|r| navigable_kind(&r.kind))
        .map(|r| r.id)
}

/// First navigable item strictly after a module and all of its direct children in outline order.
pub fn first_navigable_after_module(rows: &[CourseStructureItemRow], module_id: Uuid) -> Option<Uuid> {
    let ordered = order_structure_rows(rows.to_vec());
    let si = ordered.iter().position(|r| r.id == module_id)?;
    let mut j = si + 1;
    while j < ordered.len() && ordered[j].parent_id == Some(module_id) {
        j += 1;
    }
    for k in j..ordered.len() {
        if navigable_kind(&ordered[k].kind) {
            return Some(ordered[k].id);
        }
    }
    None
}

fn module_visible_to_student_now(m: &CourseStructureItemRow, now: DateTime<Utc>) -> bool {
    m.kind == "module" && m.published && !m.archived && m.visible_from.is_none_or(|t| t <= now)
}

/// Strips archived outline rows and any child whose parent module is archived.
/// Applied to the main course structure API so clients never receive archived items in that payload.
pub fn filter_archived_items_from_structure_list(
    rows: Vec<CourseStructureItemRow>,
) -> Vec<CourseStructureItemRow> {
    let archived_module_ids: HashSet<Uuid> = rows
        .iter()
        .filter(|r| r.kind == "module" && r.archived)
        .map(|r| r.id)
        .collect();

    rows.into_iter()
        .filter(|r| {
            if r.archived {
                return false;
            }
            if let Some(pid) = r.parent_id {
                if archived_module_ids.contains(&pid) {
                    return false;
                }
            }
            true
        })
        .collect()
}

/// Archived module children (staff-only list) plus their parent module rows for display.
pub async fn list_archived_staff_structure(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Vec<CourseStructureItemRow>, sqlx::Error> {
    let archived_children = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        SELECT id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        FROM {}
        WHERE course_id = $1
          AND archived = true
          AND parent_id IS NOT NULL
          AND kind IN ('heading', 'content_page', 'assignment', 'quiz', 'external_link', 'survey', 'lti_link')
        ORDER BY parent_id, sort_order
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .fetch_all(pool)
    .await?;

    if archived_children.is_empty() {
        return Ok(Vec::new());
    }

    let parent_ids: Vec<Uuid> = archived_children
        .iter()
        .filter_map(|r| r.parent_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    let mut parents = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        SELECT id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        FROM {}
        WHERE course_id = $1
          AND kind = 'module'
          AND parent_id IS NULL
          AND id = ANY($2)
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(&parent_ids)
    .fetch_all(pool)
    .await?;

    parents.sort_by_key(|r| r.sort_order);

    let mut out = parents;
    out.extend(archived_children);
    Ok(out)
}

/// Drops modules (and their children) that are not yet visible to enrolled students who are not staff.
/// Excludes archived modules and archived child items (module children of any supported kind).
pub fn filter_structure_for_student_view(
    rows: Vec<CourseStructureItemRow>,
    now: DateTime<Utc>,
) -> Vec<CourseStructureItemRow> {
    let modules: HashMap<Uuid, CourseStructureItemRow> = rows
        .iter()
        .filter(|r| r.kind == "module" && r.parent_id.is_none())
        .map(|r| (r.id, r.clone()))
        .collect();

    rows.into_iter()
        .filter(|r| {
            if r.kind == "module" && r.parent_id.is_none() {
                module_visible_to_student_now(r, now)
            } else if let Some(pid) = r.parent_id {
                modules
                    .get(&pid)
                    .map(|m| module_visible_to_student_now(m, now) && r.published && !r.archived)
                    .unwrap_or(false)
            } else {
                true
            }
        })
        .collect()
}

/// Whether a content page under a module may be viewed by a student (not draft / not before `visible_from`).
/// Sets or clears `due_at` on a content page row. `due_at` `None` stores SQL NULL.
pub async fn set_content_page_due_at(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    due_at: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET due_at = $3, updated_at = NOW()
        WHERE id = $1 AND course_id = $2 AND kind = 'content_page'
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(due_at)
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

pub async fn content_page_visible_to_student(
    pool: &PgPool,
    course_id: Uuid,
    content_page_id: Uuid,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let row: Option<(
        bool,
        bool,
        bool,
        bool,
        Option<DateTime<Utc>>,
        String,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT
            page.published,
            page.archived,
            m.published,
            m.archived,
            m.visible_from,
            crs.schedule_mode,
            crs.relative_schedule_anchor_at,
            stu.created_at
        FROM {items} page
        INNER JOIN {items} m
            ON m.id = page.parent_id AND m.course_id = page.course_id AND m.kind = 'module'
        INNER JOIN {crs} crs ON crs.id = page.course_id
        LEFT JOIN {enu} stu
            ON stu.course_id = crs.id AND stu.user_id = $3 AND stu.role = 'student'
        WHERE page.id = $1 AND page.course_id = $2 AND page.kind = 'content_page'
        "#,
        items = schema::COURSE_STRUCTURE_ITEMS,
        crs = schema::COURSES,
        enu = schema::COURSE_ENROLLMENTS,
    ))
    .bind(content_page_id)
    .bind(course_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let base = row
        .map(
            |(c_pub, c_arch, m_pub, m_arch, vf, schedule_mode, anchor, enrolled_at)| {
                let effective_vf = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, vf)
                        }
                        _ => vf,
                    }
                } else {
                    vf
                };
                c_pub && !c_arch && m_pub && !m_arch && effective_vf.is_none_or(|t| t <= now)
            },
        )
        .unwrap_or(false);
    if !base {
        return Ok(false);
    }
    if competency_gating::student_structure_item_competency_blocked_under_parent(
        pool,
        course_id,
        content_page_id,
        user_id,
    )
    .await?
    {
        return Ok(false);
    }
    Ok(true)
}

pub async fn set_assignment_due_at(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    due_at: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET due_at = $3, updated_at = NOW()
        WHERE id = $1 AND course_id = $2 AND kind = 'assignment'
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(due_at)
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

pub async fn assignment_visible_to_student(
    pool: &PgPool,
    course_id: Uuid,
    assignment_id: Uuid,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let row: Option<(
        bool,
        bool,
        bool,
        bool,
        Option<DateTime<Utc>>,
        String,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT
            page.published,
            page.archived,
            m.published,
            m.archived,
            m.visible_from,
            crs.schedule_mode,
            crs.relative_schedule_anchor_at,
            stu.created_at,
            ma.available_from,
            ma.available_until
        FROM {items} page
        INNER JOIN {items} m
            ON m.id = page.parent_id AND m.course_id = page.course_id AND m.kind = 'module'
        INNER JOIN {crs} crs ON crs.id = page.course_id
        LEFT JOIN {enu} stu
            ON stu.course_id = crs.id AND stu.user_id = $3 AND stu.role = 'student'
        LEFT JOIN {ma} ma ON ma.structure_item_id = page.id
        WHERE page.id = $1 AND page.course_id = $2 AND page.kind = 'assignment'
        "#,
        items = schema::COURSE_STRUCTURE_ITEMS,
        crs = schema::COURSES,
        enu = schema::COURSE_ENROLLMENTS,
        ma = schema::MODULE_ASSIGNMENTS,
    ))
    .bind(assignment_id)
    .bind(course_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let base = row
        .map(
            |(
                c_pub,
                c_arch,
                m_pub,
                m_arch,
                vf,
                schedule_mode,
                anchor,
                enrolled_at,
                available_from,
                available_until,
            )| {
                let effective_vf = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, vf)
                        }
                        _ => vf,
                    }
                } else {
                    vf
                };
                let eff_af = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, available_from)
                        }
                        _ => available_from,
                    }
                } else {
                    available_from
                };
                let eff_au = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, available_until)
                        }
                        _ => available_until,
                    }
                } else {
                    available_until
                };
                let within_availability = eff_af.map_or(true, |t| now >= t)
                    && eff_au.map_or(true, |t| now <= t);
                c_pub
                    && !c_arch
                    && m_pub
                    && !m_arch
                    && effective_vf.is_none_or(|t| t <= now)
                    && within_availability
            },
        )
        .unwrap_or(false);
    if !base {
        return Ok(false);
    }
    if competency_gating::student_structure_item_competency_blocked_under_parent(
        pool,
        course_id,
        assignment_id,
        user_id,
    )
    .await?
    {
        return Ok(false);
    }
    Ok(true)
}

pub async fn set_quiz_due_at(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    due_at: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET due_at = $3, updated_at = NOW()
        WHERE id = $1 AND course_id = $2 AND kind = 'quiz'
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(due_at)
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

pub async fn quiz_visible_to_student(
    pool: &PgPool,
    course_id: Uuid,
    quiz_id: Uuid,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let row: Option<(
        bool,
        bool,
        bool,
        bool,
        Option<DateTime<Utc>>,
        String,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT
            page.published,
            page.archived,
            m.published,
            m.archived,
            m.visible_from,
            crs.schedule_mode,
            crs.relative_schedule_anchor_at,
            stu.created_at
        FROM {items} page
        INNER JOIN {items} m
            ON m.id = page.parent_id AND m.course_id = page.course_id AND m.kind = 'module'
        INNER JOIN {crs} crs ON crs.id = page.course_id
        LEFT JOIN {enu} stu
            ON stu.course_id = crs.id AND stu.user_id = $3 AND stu.role = 'student'
        WHERE page.id = $1 AND page.course_id = $2 AND page.kind = 'quiz'
        "#,
        items = schema::COURSE_STRUCTURE_ITEMS,
        crs = schema::COURSES,
        enu = schema::COURSE_ENROLLMENTS,
    ))
    .bind(quiz_id)
    .bind(course_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let base = row
        .map(
            |(c_pub, c_arch, m_pub, m_arch, vf, schedule_mode, anchor, enrolled_at)| {
                let effective_vf = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, vf)
                        }
                        _ => vf,
                    }
                } else {
                    vf
                };
                c_pub && !c_arch && m_pub && !m_arch && effective_vf.is_none_or(|t| t <= now)
            },
        )
        .unwrap_or(false);
    if !base {
        return Ok(false);
    }
    if competency_gating::student_structure_item_competency_blocked_under_parent(
        pool,
        course_id,
        quiz_id,
        user_id,
    )
    .await?
    {
        return Ok(false);
    }
    Ok(true)
}

pub async fn external_link_visible_to_student(
    pool: &PgPool,
    course_id: Uuid,
    link_id: Uuid,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let row: Option<(
        bool,
        bool,
        bool,
        bool,
        Option<DateTime<Utc>>,
        String,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT
            page.published,
            page.archived,
            m.published,
            m.archived,
            m.visible_from,
            crs.schedule_mode,
            crs.relative_schedule_anchor_at,
            stu.created_at
        FROM {items} page
        INNER JOIN {items} m
            ON m.id = page.parent_id AND m.course_id = page.course_id AND m.kind = 'module'
        INNER JOIN {crs} crs ON crs.id = page.course_id
        LEFT JOIN {enu} stu
            ON stu.course_id = crs.id AND stu.user_id = $3 AND stu.role = 'student'
        WHERE page.id = $1 AND page.course_id = $2 AND page.kind = 'external_link'
        "#,
        items = schema::COURSE_STRUCTURE_ITEMS,
        crs = schema::COURSES,
        enu = schema::COURSE_ENROLLMENTS,
    ))
    .bind(link_id)
    .bind(course_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let base = row
        .map(
            |(c_pub, c_arch, m_pub, m_arch, vf, schedule_mode, anchor, enrolled_at)| {
                let effective_vf = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, vf)
                        }
                        _ => vf,
                    }
                } else {
                    vf
                };
                c_pub && !c_arch && m_pub && !m_arch && effective_vf.is_none_or(|t| t <= now)
            },
        )
        .unwrap_or(false);
    if !base {
        return Ok(false);
    }
    if competency_gating::student_structure_item_competency_blocked_under_parent(
        pool,
        course_id,
        link_id,
        user_id,
    )
    .await?
    {
        return Ok(false);
    }
    Ok(true)
}

pub async fn lti_link_visible_to_student(
    pool: &PgPool,
    course_id: Uuid,
    link_id: Uuid,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let row: Option<(
        bool,
        bool,
        bool,
        bool,
        Option<DateTime<Utc>>,
        String,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT
            page.published,
            page.archived,
            m.published,
            m.archived,
            m.visible_from,
            crs.schedule_mode,
            crs.relative_schedule_anchor_at,
            stu.created_at
        FROM {items} page
        INNER JOIN {items} m
            ON m.id = page.parent_id AND m.course_id = page.course_id AND m.kind = 'module'
        INNER JOIN {crs} crs ON crs.id = page.course_id
        LEFT JOIN {enu} stu
            ON stu.course_id = crs.id AND stu.user_id = $3 AND stu.role = 'student'
        WHERE page.id = $1 AND page.course_id = $2 AND page.kind = 'lti_link'
        "#,
        items = schema::COURSE_STRUCTURE_ITEMS,
        crs = schema::COURSES,
        enu = schema::COURSE_ENROLLMENTS,
    ))
    .bind(link_id)
    .bind(course_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let base = row
        .map(
            |(c_pub, c_arch, m_pub, m_arch, vf, schedule_mode, anchor, enrolled_at)| {
                let effective_vf = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, vf)
                        }
                        _ => vf,
                    }
                } else {
                    vf
                };
                c_pub && !c_arch && m_pub && !m_arch && effective_vf.is_none_or(|t| t <= now)
            },
        )
        .unwrap_or(false);
    if !base {
        return Ok(false);
    }
    if competency_gating::student_structure_item_competency_blocked_under_parent(
        pool,
        course_id,
        link_id,
        user_id,
    )
    .await?
    {
        return Ok(false);
    }
    Ok(true)
}

pub async fn survey_visible_to_student(
    pool: &PgPool,
    course_id: Uuid,
    survey_id: Uuid,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let row: Option<(
        bool,
        bool,
        bool,
        bool,
        Option<DateTime<Utc>>,
        String,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(&format!(
        r#"
        SELECT
            page.published,
            page.archived,
            m.published,
            m.archived,
            m.visible_from,
            crs.schedule_mode,
            crs.relative_schedule_anchor_at,
            stu.created_at,
            s.opens_at,
            s.closes_at
        FROM {items} page
        INNER JOIN {items} m
            ON m.id = page.parent_id AND m.course_id = page.course_id AND m.kind = 'module'
        INNER JOIN {crs} crs ON crs.id = page.course_id
        LEFT JOIN {enu} stu
            ON stu.course_id = crs.id AND stu.user_id = $3 AND stu.role = 'student'
        LEFT JOIN {surveys} s ON s.structure_item_id = page.id
        WHERE page.id = $1 AND page.course_id = $2 AND page.kind = 'survey'
        "#,
        items = schema::COURSE_STRUCTURE_ITEMS,
        crs = schema::COURSES,
        enu = schema::COURSE_ENROLLMENTS,
        surveys = schema::MODULE_SURVEYS,
    ))
    .bind(survey_id)
    .bind(course_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let base = row
        .map(
            |(c_pub, c_arch, m_pub, m_arch, vf, schedule_mode, anchor, enrolled_at, opens_at, closes_at)| {
                let effective_vf = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, vf)
                        }
                        _ => vf,
                    }
                } else {
                    vf
                };
                let eff_open = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, opens_at)
                        }
                        _ => opens_at,
                    }
                } else {
                    opens_at
                };
                let eff_close = if schedule_mode == "relative" {
                    match (anchor, enrolled_at) {
                        (Some(anchor), Some(enrollment_start)) => {
                            let ctx = RelativeShiftContext {
                                enrollment_start,
                                anchor,
                            };
                            relative_schedule::shift_opt(&ctx, closes_at)
                        }
                        _ => closes_at,
                    }
                } else {
                    closes_at
                };
                let within_window = eff_open.map_or(true, |t| now >= t) && eff_close.map_or(true, |t| now <= t);
                c_pub && !c_arch && m_pub && !m_arch && effective_vf.is_none_or(|t| t <= now) && within_window
            },
        )
        .unwrap_or(false);
    if !base {
        return Ok(false);
    }
    if competency_gating::student_structure_item_competency_blocked_under_parent(
        pool,
        course_id,
        survey_id,
        user_id,
    )
    .await?
    {
        return Ok(false);
    }
    Ok(true)
}

pub async fn update_module(
    pool: &PgPool,
    course_id: Uuid,
    module_id: Uuid,
    title: &str,
    published: bool,
    visible_from: Option<DateTime<Utc>>,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        UPDATE {}
        SET title = $3,
            published = $4,
            visible_from = $5,
            updated_at = NOW()
        WHERE id = $1 AND course_id = $2 AND kind = 'module' AND parent_id IS NULL
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(course_id)
    .bind(title)
    .bind(published)
    .bind(visible_from)
    .fetch_optional(pool)
    .await?
    .ok_or(sqlx::Error::RowNotFound)
}

/// Appends a module with the next top-level `sort_order` (serialized with `FOR UPDATE` on the course row).
pub async fn insert_module(
    pool: &PgPool,
    course_id: Uuid,
    title: &str,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let new_id = Uuid::new_v4();

    let row = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) AS max_ord
            FROM {}
            WHERE course_id = $1 AND parent_id IS NULL
        )
        INSERT INTO {} (id, course_id, sort_order, kind, title, parent_id)
        SELECT $2, $1, max_ord + 1, 'module', $3, NULL
        FROM mx
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(new_id)
    .bind(title)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(row)
}

/// Appends a heading under an existing module (same course, `kind = module`).
pub async fn insert_heading_under_module(
    pool: &PgPool,
    course_id: Uuid,
    module_id: Uuid,
    title: &str,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let parent_ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {}
            WHERE id = $1 AND course_id = $2 AND kind = 'module'
        )
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(course_id)
    .fetch_one(&mut *tx)
    .await?;

    if !parent_ok {
        return Err(sqlx::Error::RowNotFound);
    }

    let new_id = Uuid::new_v4();

    let row = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) AS max_ord
            FROM {}
            WHERE parent_id = $1
        )
        INSERT INTO {} (id, course_id, sort_order, kind, title, parent_id)
        SELECT $2, $3, max_ord + 1, 'heading', $4, $1
        FROM mx
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(new_id)
    .bind(course_id)
    .bind(title)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(row)
}

/// Appends an assignment under an existing module and creates an empty `module_assignments` body row.
pub async fn insert_assignment_under_module(
    pool: &PgPool,
    course_id: Uuid,
    module_id: Uuid,
    title: &str,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let parent_ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {}
            WHERE id = $1 AND course_id = $2 AND kind = 'module'
        )
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(course_id)
    .fetch_one(&mut *tx)
    .await?;

    if !parent_ok {
        return Err(sqlx::Error::RowNotFound);
    }

    let new_id = Uuid::new_v4();

    let row = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) AS max_ord
            FROM {}
            WHERE parent_id = $1
        )
        INSERT INTO {} (id, course_id, sort_order, kind, title, parent_id)
        SELECT $2, $3, max_ord + 1, 'assignment', $4, $1
        FROM mx
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(new_id)
    .bind(course_id)
    .bind(title)
    .fetch_one(&mut *tx)
    .await?;

    course_module_assignments::insert_empty_for_item(&mut tx, new_id).await?;

    tx.commit().await?;
    Ok(row)
}

/// Appends a content page under an existing module (`kind = content_page`) and creates an empty body row.
pub async fn insert_content_page_under_module(
    pool: &PgPool,
    course_id: Uuid,
    module_id: Uuid,
    title: &str,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let parent_ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {}
            WHERE id = $1 AND course_id = $2 AND kind = 'module'
        )
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(course_id)
    .fetch_one(&mut *tx)
    .await?;

    if !parent_ok {
        return Err(sqlx::Error::RowNotFound);
    }

    let new_id = Uuid::new_v4();

    let row = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) AS max_ord
            FROM {}
            WHERE parent_id = $1
        )
        INSERT INTO {} (id, course_id, sort_order, kind, title, parent_id)
        SELECT $2, $3, max_ord + 1, 'content_page', $4, $1
        FROM mx
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(new_id)
    .bind(course_id)
    .bind(title)
    .fetch_one(&mut *tx)
    .await?;

    course_module_content::insert_empty_for_item(&mut tx, new_id).await?;

    tx.commit().await?;
    Ok(row)
}

/// Appends a quiz under an existing module (`kind = quiz`) and creates an empty quiz body row.
pub async fn insert_quiz_under_module(
    pool: &PgPool,
    course_id: Uuid,
    module_id: Uuid,
    title: &str,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let parent_ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {}
            WHERE id = $1 AND course_id = $2 AND kind = 'module'
        )
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(course_id)
    .fetch_one(&mut *tx)
    .await?;

    if !parent_ok {
        return Err(sqlx::Error::RowNotFound);
    }

    let new_id = Uuid::new_v4();

    let row = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) AS max_ord
            FROM {}
            WHERE parent_id = $1
        )
        INSERT INTO {} (id, course_id, sort_order, kind, title, parent_id)
        SELECT $2, $3, max_ord + 1, 'quiz', $4, $1
        FROM mx
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(new_id)
    .bind(course_id)
    .bind(title)
    .fetch_one(&mut *tx)
    .await?;

    course_module_quizzes::insert_empty_for_item(&mut tx, new_id).await?;

    tx.commit().await?;
    Ok(row)
}

/// Appends an external link under an existing module and stores the destination URL.
pub async fn insert_external_link_under_module(
    pool: &PgPool,
    course_id: Uuid,
    module_id: Uuid,
    title: &str,
    url: &str,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let parent_ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {}
            WHERE id = $1 AND course_id = $2 AND kind = 'module'
        )
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(course_id)
    .fetch_one(&mut *tx)
    .await?;

    if !parent_ok {
        return Err(sqlx::Error::RowNotFound);
    }

    let new_id = Uuid::new_v4();

    let row = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) AS max_ord
            FROM {}
            WHERE parent_id = $1
        )
        INSERT INTO {} (id, course_id, sort_order, kind, title, parent_id)
        SELECT $2, $3, max_ord + 1, 'external_link', $4, $1
        FROM mx
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(new_id)
    .bind(course_id)
    .bind(title)
    .fetch_one(&mut *tx)
    .await?;

    course_module_external_links::insert_empty_for_item(&mut tx, new_id, url).await?;

    tx.commit().await?;
    Ok(row)
}

/// Appends an LTI resource link under an existing module (`kind = lti_link`).
pub async fn insert_lti_link_under_module(
    pool: &PgPool,
    course_id: Uuid,
    module_id: Uuid,
    title: &str,
    external_tool_id: Uuid,
    resource_link_id: &str,
    line_item_url: Option<&str>,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let parent_ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {}
            WHERE id = $1 AND course_id = $2 AND kind = 'module'
        )
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(course_id)
    .fetch_one(&mut *tx)
    .await?;

    if !parent_ok {
        return Err(sqlx::Error::RowNotFound);
    }

    let new_id = Uuid::new_v4();

    let row = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) AS max_ord
            FROM {}
            WHERE parent_id = $1
        )
        INSERT INTO {} (id, course_id, sort_order, kind, title, parent_id)
        SELECT $2, $3, max_ord + 1, 'lti_link', $4, $1
        FROM mx
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(new_id)
    .bind(course_id)
    .bind(title)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, structure_item_id, external_tool_id, resource_link_id, title, line_item_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        schema::LTI_RESOURCE_LINKS
    ))
    .bind(course_id)
    .bind(new_id)
    .bind(external_tool_id)
    .bind(resource_link_id)
    .bind(title)
    .bind(line_item_url)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(row)
}

/// Appends a survey under an existing module (`kind = survey`) and creates an empty survey row.
pub async fn insert_survey_under_module(
    pool: &PgPool,
    course_id: Uuid,
    module_id: Uuid,
    title: &str,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let parent_ok = sqlx::query_scalar::<_, bool>(&format!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM {}
            WHERE id = $1 AND course_id = $2 AND kind = 'module'
        )
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(course_id)
    .fetch_one(&mut *tx)
    .await?;

    if !parent_ok {
        return Err(sqlx::Error::RowNotFound);
    }

    let new_id = Uuid::new_v4();
    let row = sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        WITH mx AS (
            SELECT COALESCE(MAX(sort_order), -1) AS max_ord
            FROM {}
            WHERE parent_id = $1
        )
        INSERT INTO {} (id, course_id, sort_order, kind, title, parent_id)
        SELECT $2, $3, max_ord + 1, 'survey', $4, $1
        FROM mx
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(module_id)
    .bind(new_id)
    .bind(course_id)
    .bind(title)
    .fetch_one(&mut *tx)
    .await?;

    course_module_surveys::insert_empty_for_item(&mut tx, new_id).await?;

    tx.commit().await?;
    Ok(row)
}

const REORDER_OFFSET: i32 = 10_000_000;

/// Reassigns `sort_order` for top-level modules and each module's children. `module_ids_in_order`
/// must list every **non-archived** top-level module id. For each such module, `children_by_module`
/// must list every **non-archived** child id in the desired order; modules with no children
/// use an empty vec (or may be omitted from the map). Archived modules and children are unchanged.
pub async fn apply_module_and_child_order(
    pool: &PgPool,
    course_id: Uuid,
    module_ids_in_order: &[Uuid],
    children_by_module: &HashMap<Uuid, Vec<Uuid>>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query_scalar::<_, Uuid>(&format!(
        "SELECT id FROM {} WHERE id = $1 FOR UPDATE",
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| sqlx::Error::RowNotFound)?;

    let modules_with_archived: Vec<(Uuid, bool)> = sqlx::query_as(&format!(
        r#"
        SELECT id, archived
        FROM {}
        WHERE course_id = $1 AND parent_id IS NULL AND kind = 'module'
        ORDER BY sort_order
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .fetch_all(&mut *tx)
    .await?;

    let visible_modules: Vec<Uuid> = modules_with_archived
        .iter()
        .filter(|(_, archived)| !archived)
        .map(|(id, _)| *id)
        .collect();
    let visible_mod_set: HashSet<Uuid> = visible_modules.iter().copied().collect();
    let order_set: HashSet<Uuid> = module_ids_in_order.iter().copied().collect();
    if visible_mod_set != order_set {
        return Err(sqlx::Error::RowNotFound);
    }

    for &mid in &visible_modules {
        let rows: Vec<(Uuid, bool)> = sqlx::query_as(&format!(
            r#"
            SELECT id, archived
            FROM {}
            WHERE parent_id = $1
            ORDER BY sort_order
            "#,
            schema::COURSE_STRUCTURE_ITEMS
        ))
        .bind(mid)
        .fetch_all(&mut *tx)
        .await?;

        let visible_child_ids: Vec<Uuid> = rows
            .iter()
            .filter(|(_, archived)| !archived)
            .map(|(id, _)| *id)
            .collect();
        let visible_child_set: HashSet<Uuid> = visible_child_ids.iter().copied().collect();
        let specified = children_by_module.get(&mid).cloned().unwrap_or_default();
        let spec_set: HashSet<Uuid> = specified.iter().copied().collect();
        if visible_child_set != spec_set {
            return Err(sqlx::Error::RowNotFound);
        }
    }

    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET sort_order = sort_order + $2
        WHERE course_id = $1 AND parent_id IS NULL AND kind = 'module'
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .bind(REORDER_OFFSET)
    .execute(&mut *tx)
    .await?;

    for (ord, &id) in module_ids_in_order.iter().enumerate() {
        sqlx::query(&format!(
            r#"
            UPDATE {}
            SET sort_order = $3
            WHERE id = $1 AND course_id = $2 AND parent_id IS NULL AND kind = 'module'
            "#,
            schema::COURSE_STRUCTURE_ITEMS
        ))
        .bind(id)
        .bind(course_id)
        .bind(ord as i32)
        .execute(&mut *tx)
        .await?;
    }

    for &mid in &visible_modules {
        let child_ids = children_by_module.get(&mid).cloned().unwrap_or_default();
        if child_ids.is_empty() {
            continue;
        }

        sqlx::query(&format!(
            r#"
            UPDATE {}
            SET sort_order = sort_order + $2
            WHERE parent_id = $1
            "#,
            schema::COURSE_STRUCTURE_ITEMS
        ))
        .bind(mid)
        .bind(REORDER_OFFSET)
        .execute(&mut *tx)
        .await?;

        for (ord, &cid) in child_ids.iter().enumerate() {
            sqlx::query(&format!(
                r#"
                UPDATE {}
                SET sort_order = $3
                WHERE id = $1 AND parent_id = $2
                "#,
                schema::COURSE_STRUCTURE_ITEMS
            ))
            .bind(cid)
            .bind(mid)
            .bind(ord as i32)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(())
}

/// Updates title, `published`, and/or `archived` for a module child item (not a top-level module).
pub async fn patch_child_structure_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    title: Option<&str>,
    published: Option<bool>,
    archived: Option<bool>,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    if title.is_none() && published.is_none() && archived.is_none() {
        return Err(sqlx::Error::RowNotFound);
    }
    sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        UPDATE {}
        SET title = COALESCE($3, title),
            published = COALESCE($4, published),
            archived = COALESCE($5, archived),
            updated_at = NOW()
        WHERE id = $1
          AND course_id = $2
          AND parent_id IS NOT NULL
          AND kind IN ('heading', 'content_page', 'assignment', 'quiz', 'external_link', 'survey', 'lti_link')
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(title)
    .bind(published)
    .bind(archived)
    .fetch_optional(pool)
    .await?
    .ok_or(sqlx::Error::RowNotFound)
}

/// Marks a module child item as archived (soft-delete).
pub async fn archive_child_structure_item(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<CourseStructureItemRow, sqlx::Error> {
    sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        UPDATE {}
        SET archived = true,
            updated_at = NOW()
        WHERE id = $1
          AND course_id = $2
          AND parent_id IS NOT NULL
          AND kind IN ('heading', 'content_page', 'assignment', 'quiz', 'external_link', 'survey', 'lti_link')
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?
    .ok_or(sqlx::Error::RowNotFound)
}

/// Sets `assignment_group_id` for a gradable module item (`content_page`, `assignment`, or `quiz`).
pub async fn set_item_assignment_group(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
    assignment_group_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET assignment_group_id = $3, updated_at = NOW()
        WHERE id = $1 AND course_id = $2 AND kind IN ('content_page', 'assignment', 'quiz')
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item_id)
    .bind(course_id)
    .bind(assignment_group_id)
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

/// Deletes all module outline rows for a course (children first). Cascades to module body tables.
pub async fn delete_all_items_for_course(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1 AND parent_id IS NOT NULL"#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .execute(pool)
    .await?;
    sqlx::query(&format!(
        r#"DELETE FROM {} WHERE course_id = $1"#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert or update a structure row for import. When `only_insert` is true, existing ids are left unchanged.
pub async fn import_upsert_structure_item(
    pool: &PgPool,
    course_id: Uuid,
    item: &CourseStructureItemResponse,
    only_insert: bool,
) -> Result<bool, sqlx::Error> {
    if only_insert {
        let id = sqlx::query_scalar::<_, Uuid>(&format!(
            r#"
            INSERT INTO {} (
                id, course_id, sort_order, kind, title, parent_id,
                published, visible_from, archived, due_at, assignment_group_id,
                created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO NOTHING
            RETURNING id
            "#,
            schema::COURSE_STRUCTURE_ITEMS
        ))
        .bind(item.id)
        .bind(course_id)
        .bind(item.sort_order)
        .bind(&item.kind)
        .bind(&item.title)
        .bind(item.parent_id)
        .bind(item.published)
        .bind(item.visible_from)
        .bind(item.archived)
        .bind(item.due_at)
        .bind(item.assignment_group_id)
        .bind(item.created_at)
        .bind(item.updated_at)
        .fetch_optional(pool)
        .await?;
        return Ok(id.is_some());
    }

    sqlx::query(&format!(
        r#"
        INSERT INTO {} (
            id, course_id, sort_order, kind, title, parent_id,
            published, visible_from, archived, due_at, assignment_group_id,
            created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
            course_id = EXCLUDED.course_id,
            sort_order = EXCLUDED.sort_order,
            kind = EXCLUDED.kind,
            title = EXCLUDED.title,
            parent_id = EXCLUDED.parent_id,
            published = EXCLUDED.published,
            visible_from = EXCLUDED.visible_from,
            archived = EXCLUDED.archived,
            due_at = EXCLUDED.due_at,
            assignment_group_id = EXCLUDED.assignment_group_id,
            updated_at = EXCLUDED.updated_at
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(item.id)
    .bind(course_id)
    .bind(item.sort_order)
    .bind(&item.kind)
    .bind(&item.title)
    .bind(item.parent_id)
    .bind(item.published)
    .bind(item.visible_from)
    .bind(item.archived)
    .bind(item.due_at)
    .bind(item.assignment_group_id)
    .bind(item.created_at)
    .bind(item.updated_at)
    .execute(pool)
    .await?;
    Ok(true)
}
