//! Quiz submission: grading, lockdown paths, gradebook updates. Used by course quiz routes.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course::CoursePublic;
use crate::models::course_module_quiz::{QuizQuestion, QuizQuestionResponseItem, QuizSubmitRequest, QuizSubmitResponse};
use crate::repos::course_grades;
use crate::repos::course_module_quizzes;
use crate::repos::quiz_attempts;
use crate::services::code_execution::{self, CodeTestCase, ExecuteCodeRequest};
use crate::services::learner_state;
use crate::services::question_bank;
use crate::services::quiz_attempt_grading;
use crate::services::quiz_lockdown;

pub fn parse_code_test_cases(q: &QuizQuestion) -> Vec<CodeTestCase> {
    q.type_config
        .get("testCases")
        .and_then(|v| serde_json::from_value::<Vec<CodeTestCase>>(v.clone()).ok())
        .unwrap_or_default()
}

async fn academic_integrity_from_focus_loss(
    mode: &str,
    threshold: Option<i32>,
    pool: &PgPool,
    attempt_id: Uuid,
) -> Result<bool, sqlx::Error> {
    if mode != quiz_lockdown::LOCKDOWN_KIOSK {
        return Ok(false);
    }
    let Some(t) = threshold.filter(|t| *t >= 1) else {
        return Ok(false);
    };
    let n = quiz_attempts::count_focus_loss_events(pool, attempt_id).await?;
    Ok(n > t as i64)
}

fn quiz_gradebook_points_with_late_policy(
    gb: f64,
    quiz_row: &course_module_quizzes::CourseItemQuizRow,
    due_effective: Option<DateTime<Utc>>,
    submitted_at: DateTime<Utc>,
) -> f64 {
    if quiz_row.late_submission_policy != "penalty" {
        return gb;
    }
    if !quiz_attempt_grading::quiz_submission_is_late(due_effective, submitted_at) {
        return gb;
    }
    match quiz_row.late_penalty_percent {
        Some(p) => quiz_attempt_grading::apply_late_penalty_to_gradebook_points(gb, p),
        None => gb,
    }
}

pub async fn grade_question_with_code_support(
    q: &QuizQuestion,
    resp: &QuizQuestionResponseItem,
) -> Result<(f64, f64, Option<bool>), AppError> {
    if q.question_type != "code" {
        return Ok(quiz_attempt_grading::grade_static_question(q, resp));
    }
    let max = if q.points < 0 { 0.0 } else { q.points as f64 };
    let Some(code_submission) = resp.code_submission.as_ref() else {
        return Ok((0.0, max, Some(false)));
    };
    code_execution::validate_code_submission_size(&code_submission.code)?;
    let test_cases = parse_code_test_cases(q);
    if test_cases.is_empty() {
        return Ok((0.0, max, None));
    }
    let language_id = q
        .type_config
        .get("languageId")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32)
        .or_else(|| {
            q.type_config
                .get("language")
                .and_then(|v| v.as_str())
                .map(code_execution::language_id_from_name)
        })
        .unwrap_or_else(|| code_execution::language_id_from_name(&code_submission.language));
    let mut passed = 0usize;
    for tc in &test_cases {
        let res = code_execution::run_code(ExecuteCodeRequest {
            language_id,
            source_code: code_submission.code.clone(),
            stdin: tc.input.clone(),
            expected_output: tc.expected_output.clone(),
            time_limit_ms: tc.time_limit_ms,
            memory_limit_kb: tc.memory_limit_kb,
        })
        .await?;
        if res.passed {
            passed += 1;
        }
    }
    let ratio = passed as f64 / test_cases.len() as f64;
    let pts = (max * ratio).clamp(0.0, max);
    Ok((pts, max, Some((ratio - 1.0).abs() < 1e-9)))
}

pub async fn submit_module_quiz(
    pool: &PgPool,
    course_row: &CoursePublic,
    course_id: Uuid,
    item_id: Uuid,
    user_id: Uuid,
    quiz_row: &course_module_quizzes::CourseItemQuizRow,
    req: &QuizSubmitRequest,
) -> Result<QuizSubmitResponse, AppError> {
    let Some(att) = quiz_attempts::get_attempt(pool, req.attempt_id).await? else {
        return Err(AppError::NotFound);
    };
    if att.student_user_id != user_id
        || att.course_id != course_id
        || att.structure_item_id != item_id
        || att.status != "in_progress"
    {
        return Err(AppError::Forbidden);
    }

    let shift_ctx =
        crate::services::relative_schedule::load_shift_context_for_user(pool, course_row, user_id)
            .await?;
    let due_effective =
        quiz_attempt_grading::quiz_effective_due_at(quiz_row.due_at, shift_ctx.as_ref());
    let now = Utc::now();
    crate::services::accommodations::require_attempt_within_deadline(&att, now)?;
    if quiz_row.late_submission_policy == "block"
        && quiz_attempt_grading::quiz_submission_is_late(due_effective, now)
    {
        return Err(AppError::invalid_input(
            "This quiz does not accept submissions after the due date.",
        ));
    }

    let mut tx = pool.begin().await?;

    if quiz_row.is_adaptive {
        let hist = req.adaptive_history.clone().ok_or_else(|| {
            AppError::invalid_input("adaptiveHistory is required for adaptive quizzes.")
        })?;
        if hist.len() != quiz_row.adaptive_question_count as usize {
            return Err(AppError::invalid_input(
                "Adaptive history length does not match this quiz configuration.",
            ));
        }
        quiz_attempts::delete_responses_for_attempt(&mut *tx, att.id).await?;
        let hist_json = serde_json::to_value(&hist).map_err(|e| AppError::invalid_input(e.to_string()))?;
        let mut earned = 0.0_f64;
        let mut possible = 0.0_f64;
        for (i, turn) in hist.iter().enumerate() {
            let max_pts = quiz_attempt_grading::adaptive_turn_max_points(turn);
            possible += max_pts;
            let ok = quiz_attempt_grading::adaptive_turn_is_correct(turn);
            let pts = if ok { max_pts } else { 0.0 };
            earned += pts;
            let rj = json!({
                "prompt": turn.prompt,
                "questionType": turn.question_type,
                "choices": turn.choices,
                "choiceWeights": turn.choice_weights,
                "selectedChoiceIndex": turn.selected_choice_index,
            });
            quiz_attempts::insert_response(
                &mut *tx,
                att.id,
                i as i32,
                None,
                &turn.question_type,
                Some(turn.prompt.as_str()),
                &rj,
                Some(ok),
                Some(pts),
                max_pts,
                false,
            )
            .await?;
        }
        let score_pct = if possible > 0.0 {
            ((earned / possible) * 100.0).clamp(0.0, 100.0) as f32
        } else {
            0.0
        };
        let ok = quiz_attempts::finalize_attempt(
            &mut *tx,
            att.id,
            now,
            earned,
            possible,
            score_pct,
            Some(&hist_json),
            false,
        )
        .await?;
        if !ok {
            return Err(AppError::invalid_input(
                "This attempt was already submitted.",
            ));
        }
        tx.commit().await?;

        if quiz_row.show_score_timing != "manual" {
            let attempts = quiz_attempts::list_submitted_attempts_for_item_student(
                pool,
                course_id,
                item_id,
                user_id,
            )
            .await?;
            if let Some((e, p)) =
                quiz_attempt_grading::pick_policy_points(&attempts, &quiz_row.grade_attempt_policy)
            {
                let gb = quiz_attempt_grading::points_for_gradebook(e, p, quiz_row.points_worth);
                let gb = quiz_gradebook_points_with_late_policy(gb, quiz_row, due_effective, now);
                course_grades::upsert_points(pool, course_id, user_id, item_id, gb).await?;
            }
        }

        return Ok(QuizSubmitResponse {
            attempt_id: att.id,
            points_earned: earned,
            points_possible: possible,
            score_percent: score_pct,
        });
    }

    let responses = req.responses.clone().unwrap_or_default();

    let resolved = question_bank::resolve_delivery_questions(
        pool,
        course_id,
        item_id,
        course_row.question_bank_enabled,
        &quiz_row.questions_json.0,
        Some(att.id),
        Some(user_id),
        false,
    )
    .await?;
    let bank: Vec<QuizQuestion> = resolved.questions;
    let mut by_id: HashMap<String, &QuizQuestion> = HashMap::new();
    for q in &bank {
        by_id.insert(q.id.clone(), q);
    }

    let qids: Vec<Uuid> = bank
        .iter()
        .filter_map(|q| Uuid::parse_str(&q.id).ok())
        .collect();
    let tag_map = crate::repos::concepts::concept_ids_for_question_ids(pool, &qids)
        .await
        .map_err(AppError::Db)?;

    let mode = quiz_lockdown::effective_lockdown_mode(course_row.lockdown_mode_enabled, quiz_row);

    let mut concept_touches: Vec<(Uuid, f64, i32)> = Vec::new();
    let (earned, possible, score_pct, academic_integrity_flag) = if quiz_lockdown::server_enforces_forward_lockdown(mode)
    {
        if !responses.is_empty() {
            return Err(AppError::invalid_input(
                "For lockdown-mode quizzes, omit responses on submit; answers are taken from your saved progress.",
            ));
        }
        let db_rows = quiz_attempts::list_responses(pool, att.id).await?;
        if db_rows.len() != bank.len() {
            return Err(AppError::invalid_input(
                "Complete each question in order before submitting this quiz.",
            ));
        }
        for (i, db_row) in db_rows.iter().enumerate() {
            if db_row.question_index != i as i32 || !db_row.locked {
                return Err(AppError::invalid_input(
                    "Quiz responses are incomplete. Use Next after each question, then submit.",
                ));
            }
        }
        quiz_attempts::delete_responses_for_attempt(&mut *tx, att.id).await?;
        let mut earned = 0.0_f64;
        let mut possible = 0.0_f64;
        for (i, db_row) in db_rows.iter().enumerate() {
            let qid = db_row.question_id.as_deref().ok_or_else(|| {
                AppError::invalid_input("Missing question id on saved response.")
            })?;
            let q = by_id
                .get(qid)
                .ok_or_else(|| AppError::invalid_input("Invalid question id."))?;
            let resp_item: QuizQuestionResponseItem =
                serde_json::from_value(db_row.response_json.clone()).map_err(|e| {
                    AppError::invalid_input(format!("Could not read saved answer: {e}"))
                })?;
            let (pts, max_pts, is_ok) = grade_question_with_code_support(q, &resp_item).await?;
            earned += pts;
            possible += max_pts;
            let rj = json!({
                "selectedChoiceIndex": resp_item.selected_choice_index,
                "selectedChoiceIndices": resp_item.selected_choice_indices,
                "textAnswer": resp_item.text_answer,
                "matchingPairs": &resp_item.matching_pairs,
                "orderingSequence": &resp_item.ordering_sequence,
                "hotspotClick": &resp_item.hotspot_click,
                "numericValue": &resp_item.numeric_value,
                "formulaLatex": &resp_item.formula_latex,
                "codeSubmission": &resp_item.code_submission,
                "fileKey": &resp_item.file_key,
                "audioKey": &resp_item.audio_key,
                "videoKey": &resp_item.video_key,
            });
            quiz_attempts::insert_response(
                &mut *tx,
                att.id,
                i as i32,
                Some(qid),
                &q.question_type,
                Some(q.prompt.as_str()),
                &rj,
                is_ok,
                Some(pts),
                max_pts,
                false,
            )
            .await?;
            let extra: &[Uuid] = Uuid::parse_str(qid)
                .ok()
                .and_then(|u| tag_map.get(&u).map(|v| v.as_slice()))
                .unwrap_or(&[]);
            learner_state::collect_concept_touches_from_question(
                q,
                i as i32,
                pts,
                max_pts,
                extra,
                &mut concept_touches,
            );
        }
        let score_pct = if possible > 0.0 {
            ((earned / possible) * 100.0).clamp(0.0, 100.0) as f32
        } else {
            0.0
        };
        let academic_integrity_flag =
            academic_integrity_from_focus_loss(mode, quiz_row.focus_loss_threshold, pool, att.id)
                .await?;
        (earned, possible, score_pct, academic_integrity_flag)
    } else {
        if responses.is_empty() {
            return Err(AppError::invalid_input(
                "responses is required for non-adaptive quizzes.",
            ));
        }
        if !resolved.uses_server_question_sampling {
            if let Some(pool_n) = quiz_row.random_question_pool_count {
                if pool_n >= 1 && responses.len() != pool_n as usize {
                    return Err(AppError::invalid_input(
                        "Submitted response count does not match the configured question pool size.",
                    ));
                }
            }
        }
        for r in &responses {
            if !by_id.contains_key(&r.question_id) {
                return Err(AppError::invalid_input(
                    "One or more question ids are not part of this quiz.",
                ));
            }
        }

        quiz_attempts::delete_responses_for_attempt(&mut *tx, att.id).await?;

        let mut earned = 0.0_f64;
        let mut possible = 0.0_f64;
        for (i, resp_item) in responses.iter().enumerate() {
            let q = by_id
                .get(&resp_item.question_id)
                .ok_or_else(|| AppError::invalid_input("Invalid question id."))?;
            let (pts, max_pts, is_ok) = grade_question_with_code_support(q, resp_item).await?;
            earned += pts;
            possible += max_pts;
            let rj = json!({
                "selectedChoiceIndex": resp_item.selected_choice_index,
                "selectedChoiceIndices": resp_item.selected_choice_indices,
                "textAnswer": resp_item.text_answer,
                "matchingPairs": &resp_item.matching_pairs,
                "orderingSequence": &resp_item.ordering_sequence,
                "hotspotClick": &resp_item.hotspot_click,
                "numericValue": &resp_item.numeric_value,
                "formulaLatex": &resp_item.formula_latex,
                "codeSubmission": &resp_item.code_submission,
                "fileKey": &resp_item.file_key,
                "audioKey": &resp_item.audio_key,
                "videoKey": &resp_item.video_key,
            });
            quiz_attempts::insert_response(
                &mut *tx,
                att.id,
                i as i32,
                Some(resp_item.question_id.as_str()),
                &q.question_type,
                Some(q.prompt.as_str()),
                &rj,
                is_ok,
                Some(pts),
                max_pts,
                false,
            )
            .await?;
            let extra: &[Uuid] = Uuid::parse_str(&resp_item.question_id)
                .ok()
                .and_then(|u| tag_map.get(&u).map(|v| v.as_slice()))
                .unwrap_or(&[]);
            learner_state::collect_concept_touches_from_question(
                q,
                i as i32,
                pts,
                max_pts,
                extra,
                &mut concept_touches,
            );
        }

        let score_pct = if possible > 0.0 {
            ((earned / possible) * 100.0).clamp(0.0, 100.0) as f32
        } else {
            0.0
        };
        let academic_integrity_flag =
            academic_integrity_from_focus_loss(mode, quiz_row.focus_loss_threshold, pool, att.id)
                .await?;
        (earned, possible, score_pct, academic_integrity_flag)
    };

    learner_state::apply_quiz_grades_mastery(
        &mut *tx,
        course_id,
        user_id,
        att.id,
        &concept_touches,
    )
    .await?;

    let ok = quiz_attempts::finalize_attempt(
        &mut *tx,
        att.id,
        now,
        earned,
        possible,
        score_pct,
        None,
        academic_integrity_flag,
    )
    .await?;
    if !ok {
        return Err(AppError::invalid_input(
            "This attempt was already submitted.",
        ));
    }
    tx.commit().await?;

    if quiz_row.show_score_timing != "manual" {
        let attempts = quiz_attempts::list_submitted_attempts_for_item_student(
            pool,
            course_id,
            item_id,
            user_id,
        )
        .await?;
        if let Some((e, p)) =
            quiz_attempt_grading::pick_policy_points(&attempts, &quiz_row.grade_attempt_policy)
        {
            let gb = quiz_attempt_grading::points_for_gradebook(e, p, quiz_row.points_worth);
            let gb = quiz_gradebook_points_with_late_policy(gb, quiz_row, due_effective, now);
            course_grades::upsert_points(pool, course_id, user_id, item_id, gb).await?;
        }
    }

    Ok(QuizSubmitResponse {
        attempt_id: att.id,
        points_earned: earned,
        points_possible: possible,
        score_percent: score_pct,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_mc_question() -> QuizQuestion {
        QuizQuestion {
            id: "q1".into(),
            prompt: "x".into(),
            question_type: "multiple_choice".into(),
            choices: vec![],
            type_config: json!({}),
            correct_choice_index: None,
            multiple_answer: false,
            answer_with_image: false,
            required: true,
            points: 1,
            estimated_minutes: 2,
            concept_ids: vec![],
        }
    }

    #[test]
    fn parse_code_test_cases_empty_without_array() {
        let q = sample_mc_question();
        assert!(parse_code_test_cases(&q).is_empty());
    }

    #[test]
    fn parse_code_test_cases_reads_test_cases_array() {
        let mut q = sample_mc_question();
        q.type_config = json!({
            "testCases": [
                { "input": "1", "expectedOutput": "2", "timeLimitMs": 1000, "memoryLimitKb": 65536 }
            ]
        });
        let cases = parse_code_test_cases(&q);
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].input, "1");
        assert_eq!(cases[0].expected_output, "2");
        assert_eq!(cases[0].time_limit_ms, 1000);
    }
}
