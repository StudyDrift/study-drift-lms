//! Revision requests and resubmission (plan 3.13).

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::communication;
use crate::repos::course_structure;
use crate::repos::grade_audit_events;
use crate::repos::module_assignment_submissions;
use crate::repos::module_assignment_submissions::SubmissionRow;
use crate::repos::user;
use crate::services::course_image_upload::course_file_content_path;
use crate::state::AppState;

fn notify_user_mailbox(state: &AppState, user_id: Uuid) {
    if let Err(e) = state.comm_events.send((
        user_id,
        r#"{"type":"mailbox_updated"}"#.to_string(),
    )) {
        tracing::warn!(error = %e, %user_id, "mailbox_realtime_notify_failed");
    }
}

/// Whether the student may change their file when the resubmission workflow is enabled.
pub fn student_may_resubmit(
    now: DateTime<Utc>,
    existing: &SubmissionRow,
) -> Result<(), AppError> {
    if !existing.resubmission_requested {
        return Err(AppError::UnprocessableEntity {
            message: "Resubmission is not open for this assignment. Your instructor must request a revision first.".into(),
        });
    }
    if let Some(d) = existing.revision_due_at {
        if d < now {
            return Err(AppError::UnprocessableEntity {
                message: "Revision deadline has passed.".into(),
            });
        }
    }
    if existing.version_number >= 10 {
        return Err(AppError::UnprocessableEntity {
            message: "Maximum submission versions (10) reached for this assignment.".into(),
        });
    }
    Ok(())
}

/// Instructor requests a revision: persist state, audit, notify student, observability.
pub async fn request_revision(
    state: &AppState,
    pool: &PgPool,
    course_id: Uuid,
    course_code: &str,
    assignment_id: Uuid,
    actor_user_id: Uuid,
    student_user_id: Uuid,
    submission: &SubmissionRow,
    revision_due_at: Option<DateTime<Utc>>,
    revision_feedback: Option<&str>,
) -> Result<(), AppError> {
    let reason = {
        let mut s = String::new();
        if let Some(f) = revision_feedback.filter(|t| !t.is_empty()) {
            s.push_str("Feedback: ");
            s.push_str(f);
            s.push('\n');
        }
        if let Some(d) = revision_due_at {
            s.push_str("Revision due: ");
            s.push_str(&d.to_rfc3339());
        } else {
            s.push_str("No revision deadline was set.");
        }
        s
    };

    let mut tx = pool.begin().await?;
    let _row = module_assignment_submissions::set_revision_request_in_transaction(
        &mut tx,
        course_id,
        submission.id,
        revision_due_at,
        revision_feedback,
    )
    .await?
    .ok_or(AppError::NotFound)?;

    grade_audit_events::insert(
        &mut *tx,
        course_id,
        assignment_id,
        student_user_id,
        Some(actor_user_id),
        "revision_requested",
        None,
        None,
        None,
        None,
        Some(&reason),
    )
    .await?;
    tx.commit().await?;

    if let Some(profile) = user::get_profile_by_id(pool, student_user_id).await? {
        const SUB: &str = "Your instructor has requested a revision on an assignment.";
        let mut body = String::new();
        body.push_str("Your instructor has requested a revision in this course.\n\n");
        if let Some(item) = course_structure::get_item_row(pool, course_id, assignment_id).await? {
            body.push_str("Assignment: ");
            body.push_str(&item.title);
            body.push_str("\n\n");
        } else {
            body.push('\n');
        }
        if let Some(f) = revision_feedback.filter(|t| !t.is_empty()) {
            body.push_str("Feedback:\n");
            body.push_str(f);
            body.push_str("\n\n");
        }
        if let Some(d) = revision_due_at {
            body.push_str("Resubmit by: ");
            body.push_str(&d.to_rfc3339());
            body.push('\n');
        } else {
            body.push_str(
                "Resubmit when you are ready — your instructor did not set a specific deadline for this revision.\n",
            );
        }
        let link = format!(
            "{}/courses/{}/modules/assignment/{}",
            state.public_web_origin, course_code, assignment_id
        );
        body.push_str(&format!("\nOpen: {link}\n"));
        if communication::send_message(
            pool,
            actor_user_id,
            &profile.email,
            SUB,
            &body,
        )
        .await?
        .is_some()
        {
            notify_user_mailbox(state, student_user_id);
        }
    }

    tracing::info!(
        target: "lextures.audit",
        event = "revision_requested",
        course_id = %course_id,
        assignment_id = %assignment_id,
        student_id = %student_user_id,
        "revision request saved"
    );

    Ok(())
}

/// Build a JSON value for a submission version (caller supplies course_code for file path).
pub fn version_json(
    version_number: i32,
    submitted_at: DateTime<Utc>,
    attachment_file_id: Option<Uuid>,
    file_mime: Option<String>,
    course_code: &str,
) -> serde_json::Value {
    serde_json::json!({
        "versionNumber": version_number,
        "submittedAt": submitted_at,
        "attachmentFileId": attachment_file_id,
        "attachmentContentPath": attachment_file_id.map(|fid| course_file_content_path(course_code, fid)),
        "attachmentMimeType": file_mime,
    })
}
