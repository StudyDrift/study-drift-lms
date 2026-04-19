//! One-off helper: sync legacy `questions_json` into `course.questions` + `quiz_question_refs`
//! for every quiz in a course (requires `question_bank_enabled` on the course row).
//!
//! Usage:
//!   RUN_MIGRATIONS=1 DATABASE_URL=... cargo run -p study_drift_server --bin migrate_question_bank -- <course_code>

use study_drift_server::repos::course;
use study_drift_server::repos::course_module_quizzes;
use study_drift_server::repos::course_structure;
use study_drift_server::services::question_bank;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    study_drift_server::load_dotenv();
    let course_code = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("usage: migrate_question_bank <course_code>"))?;

    let state = study_drift_server::build_app_state_from_env().await?;
    let pool = &state.pool;

    let Some(course_row) = course::get_by_course_code(pool, &course_code).await? else {
        anyhow::bail!("unknown course_code");
    };
    if !course_row.question_bank_enabled {
        anyhow::bail!("course.question_bank_enabled must be true before running this migration");
    }

    let course_id = course_row.id;
    let rows = course_structure::list_for_course(pool, course_id).await?;
    let mut n = 0usize;
    for it in rows {
        if it.kind != "quiz" {
            continue;
        }
        let Some(qz) = course_module_quizzes::get_for_course_item(pool, course_id, it.id).await? else {
            continue;
        };
        if qz.questions_json.0.is_empty() {
            continue;
        }
        question_bank::sync_quiz_refs_from_editor_json(
            pool,
            course_id,
            it.id,
            &qz.questions_json.0,
            None,
        )
        .await?;
        n += 1;
        eprintln!("synced quiz structure_item_id={}", it.id);
    }
    eprintln!("done: {n} quizzes synced for {course_code}");
    Ok(())
}
