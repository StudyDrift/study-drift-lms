//! Learning-outcome validation, rollups, and outcome-to-item link creation.

use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_module_quiz::QuizQuestion;
use crate::models::course_outcomes_api::{CourseOutcomeLinkApi, PostCourseOutcomeLinkRequest};
use crate::repos::course_module_quizzes;
use crate::repos::course_outcomes;
use crate::repos::course_structure;
use crate::repos::enrollment;

pub fn validate_outcome_link_levels(
    measurement: Option<&str>,
    intensity: Option<&str>,
) -> Result<(&'static str, &'static str), AppError> {
    let m_raw = measurement.unwrap_or("").trim();
    let m = if m_raw.is_empty() { "formative" } else { m_raw };
    let i_raw = intensity.unwrap_or("").trim();
    let i = if i_raw.is_empty() { "medium" } else { i_raw };

    let m = course_outcomes::MEASUREMENT_LEVELS
        .iter()
        .copied()
        .find(|v| *v == m)
        .ok_or_else(|| {
            AppError::invalid_input(format!(
                "measurementLevel must be one of: {}.",
                course_outcomes::MEASUREMENT_LEVELS.join(", ")
            ))
        })?;
    let i = course_outcomes::INTENSITY_LEVELS
        .iter()
        .copied()
        .find(|v| *v == i)
        .ok_or_else(|| {
            AppError::invalid_input(format!(
                "intensityLevel must be one of: {}.",
                course_outcomes::INTENSITY_LEVELS.join(", ")
            ))
        })?;
    Ok((m, i))
}

/// One score per gradable evidence target so duplicate links (e.g. different measurement labels) do not double-count.
pub fn rollup_avg_for_outcome_links(links: &[CourseOutcomeLinkApi]) -> Option<f32> {
    let mut by_evidence: HashMap<(Uuid, String, String, Option<Uuid>), f32> = HashMap::new();
    for link in links {
        if let Some(p) = link.progress.avg_score_percent {
            let key = (
                link.structure_item_id,
                link.target_kind.clone(),
                link.quiz_question_id.clone(),
                link.sub_outcome_id,
            );
            by_evidence.entry(key).or_insert(p);
        }
    }
    if by_evidence.is_empty() {
        None
    } else {
        Some(by_evidence.values().sum::<f32>() / by_evidence.len() as f32)
    }
}

pub async fn add_outcome_link(
    pool: &PgPool,
    course_id: Uuid,
    course_code: &str,
    outcome_id: Uuid,
    req: &PostCourseOutcomeLinkRequest,
) -> Result<CourseOutcomeLinkApi, AppError> {
    let outcomes = course_outcomes::list_outcomes(pool, course_id).await?;
    if !outcomes.iter().any(|o| o.id == outcome_id) {
        return Err(AppError::NotFound);
    }

    let kind = req.target_kind.trim();
    if !matches!(kind, "assignment" | "quiz" | "quiz_question") {
        return Err(AppError::invalid_input(
            "targetKind must be assignment, quiz, or quiz_question.",
        ));
    }

    let Some(item) = course_structure::get_item_row(pool, course_id, req.structure_item_id).await?
    else {
        return Err(AppError::invalid_input(
            "That module item is not part of this course.",
        ));
    };

    let qid = req.quiz_question_id.as_deref().unwrap_or("").trim();
    let qid_store = if kind == "quiz_question" {
        if qid.is_empty() {
            return Err(AppError::invalid_input(
                "quizQuestionId is required when targetKind is quiz_question.",
            ));
        }
        let Some(quiz_row) =
            course_module_quizzes::get_for_course_item(pool, course_id, req.structure_item_id)
                .await?
        else {
            return Err(AppError::invalid_input("Quiz not found for that item."));
        };
        let questions: &[QuizQuestion] = quiz_row.questions_json.as_ref();
        if !questions.iter().any(|q| q.id == qid) {
            return Err(AppError::invalid_input(
                "That quiz does not contain a question with the given id.",
            ));
        }
        qid
    } else {
        ""
    };

    let expected_kind = match kind {
        "assignment" => "assignment",
        "quiz" | "quiz_question" => "quiz",
        _ => "",
    };
    if item.kind != expected_kind {
        return Err(AppError::invalid_input(
            "The module item type does not match targetKind.",
        ));
    }

    let (measurement_level, intensity_level) = validate_outcome_link_levels(
        req.measurement_level.as_deref(),
        req.intensity_level.as_deref(),
    )?;

    let sub_outcome_id = req.sub_outcome_id;
    if let Some(soid) = sub_outcome_id {
        let ok = course_outcomes::sub_outcome_owned_by_outcome_in_course(
            pool, course_id, outcome_id, soid,
        )
        .await?;
        if !ok {
            return Err(AppError::invalid_input(
                "subOutcomeId must belong to this outcome in the same course.",
            ));
        }
        if kind == "quiz_question" {
            return Err(AppError::invalid_input(
                "subOutcomeId is only supported for whole-quiz or assignment evidence links.",
            ));
        }
    }

    let inserted = match course_outcomes::insert_link(
        pool,
        outcome_id,
        sub_outcome_id,
        req.structure_item_id,
        kind,
        qid_store,
        measurement_level,
        intensity_level,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            if let sqlx::Error::Database(ref dbe) = e {
                if matches!(
                    dbe.constraint(),
                    Some("ux_course_outcome_links_unique_root")
                        | Some("ux_course_outcome_links_unique_sub")
                ) {
                    return Err(AppError::invalid_input(
                        "This outcome already maps that item with the same measurement and intensity levels. Change the levels or remove the existing mapping first.",
                    ));
                }
            }
            return Err(e.into());
        }
    };

    let enrolled = enrollment::list_student_users_for_course_code(pool, course_code)
        .await?
        .len() as i32;

    let progress = match kind {
        "quiz_question" => {
            course_outcomes::progress_for_quiz_question(
                pool,
                course_id,
                req.structure_item_id,
                qid_store,
                enrolled,
            )
            .await?
        }
        "assignment" | "quiz" => {
            course_outcomes::progress_for_graded_item(
                pool,
                course_id,
                req.structure_item_id,
                item.kind.as_str(),
                enrolled,
            )
            .await?
        }
        _ => unreachable!(),
    };

    Ok(CourseOutcomeLinkApi {
        id: inserted.id,
        sub_outcome_id: inserted.sub_outcome_id,
        structure_item_id: inserted.structure_item_id,
        target_kind: inserted.target_kind,
        quiz_question_id: inserted.quiz_question_id,
        measurement_level: inserted.measurement_level,
        intensity_level: inserted.intensity_level,
        item_title: item.title,
        item_kind: item.kind,
        progress,
    })
}
