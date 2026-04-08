use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::db::schema;
use crate::models::course_structure::CourseStructureItemRow;
use crate::repos::course_module_assignments;
use crate::repos::course_module_content;

pub async fn get_item_row(
    pool: &PgPool,
    course_id: Uuid,
    item_id: Uuid,
) -> Result<Option<CourseStructureItemRow>, sqlx::Error> {
    sqlx::query_as::<_, CourseStructureItemRow>(&format!(
        r#"
        SELECT id, course_id, sort_order, kind, title, parent_id, published, visible_from, due_at, assignment_group_id, created_at, updated_at
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
        SELECT id, course_id, sort_order, kind, title, parent_id, published, visible_from, due_at, assignment_group_id, created_at, updated_at
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

/// Top-level items by `sort_order`, then each module's child headings in order.
fn order_structure_rows(rows: Vec<CourseStructureItemRow>) -> Vec<CourseStructureItemRow> {
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

fn module_visible_to_student_now(m: &CourseStructureItemRow, now: DateTime<Utc>) -> bool {
    m.kind == "module" && m.published && m.visible_from.is_none_or(|t| t <= now)
}

/// Drops modules (and their children) that are not yet visible to enrolled students who are not staff.
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
                    .map(|m| module_visible_to_student_now(m, now))
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
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let row: Option<(bool, Option<DateTime<Utc>>)> = sqlx::query_as(&format!(
        r#"
        SELECT m.published, m.visible_from
        FROM {} c
        INNER JOIN {} m ON m.id = c.parent_id AND m.kind = 'module'
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'content_page'
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(content_page_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;

    Ok(row
        .map(|(published, visible_from)| published && visible_from.is_none_or(|t| t <= now))
        .unwrap_or(false))
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
    now: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let row: Option<(bool, Option<DateTime<Utc>>)> = sqlx::query_as(&format!(
        r#"
        SELECT m.published, m.visible_from
        FROM {} c
        INNER JOIN {} m ON m.id = c.parent_id AND m.kind = 'module'
        WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
        "#,
        schema::COURSE_STRUCTURE_ITEMS,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(assignment_id)
    .bind(course_id)
    .fetch_optional(pool)
    .await?;

    Ok(row
        .map(|(published, visible_from)| published && visible_from.is_none_or(|t| t <= now))
        .unwrap_or(false))
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
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, due_at, assignment_group_id, created_at, updated_at
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
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, due_at, assignment_group_id, created_at, updated_at
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
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, due_at, assignment_group_id, created_at, updated_at
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
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, due_at, assignment_group_id, created_at, updated_at
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
        RETURNING id, course_id, sort_order, kind, title, parent_id, published, visible_from, due_at, assignment_group_id, created_at, updated_at
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

const REORDER_OFFSET: i32 = 10_000_000;

/// Reassigns `sort_order` for top-level modules and each module's children. `module_ids_in_order`
/// must be a permutation of all module rows for the course. For each module, `children_by_module`
/// must list every child id (heading / content_page / assignment) in the desired order; modules with no children
/// use an empty vec (or may be omitted from the map).
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

    let db_modules: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"
        SELECT id
        FROM {}
        WHERE course_id = $1 AND parent_id IS NULL AND kind = 'module'
        ORDER BY sort_order
        "#,
        schema::COURSE_STRUCTURE_ITEMS
    ))
    .bind(course_id)
    .fetch_all(&mut *tx)
    .await?;

    let db_set: HashSet<Uuid> = db_modules.iter().copied().collect();
    let order_set: HashSet<Uuid> = module_ids_in_order.iter().copied().collect();
    if db_set != order_set {
        return Err(sqlx::Error::RowNotFound);
    }

    for &mid in &db_modules {
        let rows: Vec<Uuid> = sqlx::query_scalar(&format!(
            r#"
            SELECT id
            FROM {}
            WHERE parent_id = $1
            ORDER BY sort_order
            "#,
            schema::COURSE_STRUCTURE_ITEMS
        ))
        .bind(mid)
        .fetch_all(&mut *tx)
        .await?;

        let specified = children_by_module.get(&mid).cloned().unwrap_or_default();
        let child_set: HashSet<Uuid> = rows.iter().copied().collect();
        let spec_set: HashSet<Uuid> = specified.iter().copied().collect();
        if child_set != spec_set {
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

    for &mid in &db_modules {
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

/// Sets `assignment_group_id` for a gradable module item (`content_page` or `assignment`).
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
        WHERE id = $1 AND course_id = $2 AND kind IN ('content_page', 'assignment')
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
