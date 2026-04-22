//! Database access (SQLx). **Function prefixes:** `get_` (single row or scalar by id/key),
//! `list_` (collections), `insert_` (new rows), `update_` (full or partial row updates),
//! `delete_`, `find_` (optional lookup, often by natural key). `upsert_` and `patch_` are
//! reserved for merge-on-conflict and narrow column updates. Prefer `insert_*` over `create_*`
//! for new rows to match the rest of the layer.

pub mod adaptive_path;
pub mod communication;
pub mod concepts;
pub mod content_page_markups;
pub mod course;
pub mod course_feed;
pub mod course_files;
pub mod course_grades;
pub mod course_grading;
pub mod course_grants;
pub mod course_module_assignments;
pub mod course_module_content;
pub mod course_module_external_links;
pub mod course_module_quizzes;
pub mod course_module_surveys;
pub mod course_outcomes;
pub mod course_structure;
pub mod course_syllabus;
pub mod diagnostic;
pub mod enrollment;
pub mod feedback_media;
pub mod enrollment_groups;
pub mod enrollment_quiz_overrides;
pub mod hints;
pub mod learner_model;
pub mod lti;
pub mod misconceptions;
pub mod moderated_grading;
pub mod module_assignment_submissions;
pub mod originality_platform_config;
pub mod originality_reports;
pub mod provisional_grades;
pub mod grade_change_audit;
pub mod password_reset;
pub mod qti_import;
pub mod question_bank;
pub mod quiz_attempts;
pub mod rbac;
pub mod recommendations;
pub mod reports;
pub mod srs;
pub mod standards;
pub mod student_accommodations;
pub mod submission_annotations;
pub mod syllabus_acceptance;
pub mod syllabus_markups;
pub mod system_prompts;
pub mod user;
pub mod user_ai_settings;
pub mod user_audit;
