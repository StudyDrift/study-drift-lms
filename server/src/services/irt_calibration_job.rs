//! Nightly-style 2PL marginal calibration for banked questions with enough scored responses.

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::question_bank as qb_repo;
use crate::services::irt::calibrate_2pl_marginal_grid;

const MIN_RESPONSES: usize = 200;

/// Re-fits 2PL parameters for items with at least [`MIN_RESPONSES`] dichotomous graded responses.
/// `concept_id` limits to questions tagged to that concept (optional).
pub async fn run_irt_calibration(pool: &PgPool, concept_id: Option<Uuid>) -> Result<(usize, usize), AppError> {
    let targets: Vec<(Uuid, Uuid)> = if let Some(cid) = concept_id {
        sqlx::query_as::<_, (Uuid, Uuid)>(
            r#"
            SELECT q.course_id, q.id
            FROM course.questions q
            INNER JOIN course.concept_question_tags t ON t.question_id = q.id
            WHERE t.concept_id = $1
              AND q.status = 'active'::course.question_status
              AND q.irt_status IN ('uncalibrated'::course.irt_calibration_status, 'pilot'::course.irt_calibration_status)
            "#,
        )
        .bind(cid)
        .fetch_all(pool)
        .await
        .map_err(AppError::Db)?
    } else {
        sqlx::query_as::<_, (Uuid, Uuid)>(
            r#"
            SELECT course_id, id
            FROM course.questions
            WHERE status = 'active'::course.question_status
              AND irt_status IN ('uncalibrated'::course.irt_calibration_status, 'pilot'::course.irt_calibration_status)
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(AppError::Db)?
    };

    let mut calibrated = 0usize;
    let mut examined = 0usize;
    for (course_id, question_id) in targets {
        examined += 1;
        let bits = qb_repo::list_binary_responses_for_question(pool, course_id, question_id)
            .await
            .map_err(AppError::Db)?;
        if bits.len() < MIN_RESPONSES {
            continue;
        }
        let Some((a, b)) = calibrate_2pl_marginal_grid(&bits) else {
            continue;
        };
        let ok = qb_repo::update_question_irt_fitted(
            pool,
            course_id,
            question_id,
            a,
            b,
            bits.len() as i32,
        )
        .await
        .map_err(AppError::Db)?;
        if ok {
            calibrated += 1;
            tracing::info!(
                target: "irt.calibration",
                question_id = %question_id,
                sample_n = bits.len(),
                a,
                b,
                "irt.item_calibrated"
            );
        }
    }
    tracing::info!(
        target: "irt.calibration",
        examined,
        calibrated,
        concept_id = ?concept_id,
        "irt.calibration_run_complete"
    );
    Ok((calibrated, examined))
}
