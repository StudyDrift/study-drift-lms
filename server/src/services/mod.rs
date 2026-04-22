//! Application services (business logic orchestrating repos and external systems).
//!
//! **Naming verbs:** prefer domain verbs that describe the operation (`grade_attempt`,
//! `import_canvas_page`, `resolve_relative_schedule`). Use `get_` / `list_` for read-only
//! accessors that return stored or computed data; use action verbs (`submit_`, `finalize_`,
//! `grade_`) for mutations with side effects. Avoid mixing `fetch_` / `load_` with `get_`
//! in new code—pick one family (`get_` here).

pub mod accommodations;
pub mod adaptive_path;
pub mod adaptive_quiz_ai;
pub mod adaptive_quiz_cat;
pub mod ai;
pub mod assignment_rubric_ai;
pub mod auth;
pub mod canvas_course_import;
pub mod code_execution;
pub mod common_cartridge;
pub mod competency_gating;
pub mod concept_graph;
pub mod course_export_import;
pub mod course_image_upload;
pub mod feedback_media;
pub mod feedback_media_caption;
pub mod grading;
pub mod diagnostic;
pub mod enrollments;
pub mod hint_service;
pub mod irt;
pub mod irt_calibration_job;
pub mod irt_theta;
pub mod learner_state;
pub mod mastery_transcript_pdf;
pub mod lti;
pub mod lti_jwt;
pub mod mail;
pub mod misconception;
pub mod moderated_grading;
pub mod outcomes;
pub mod originality;
pub mod qti_import;
pub mod qti_parser;
pub mod question_bank;
pub mod quiz_attempt;
pub mod quiz_attempt_grading;
pub mod quiz_auto_submit;
pub mod quiz_generation_ai;
pub mod quiz_lockdown;
pub mod quiz_submission;
pub mod recommendations;
pub mod relative_schedule;
pub mod settings_ops;
pub mod srs;
pub mod srs_scheduler;
pub mod standards;
pub mod student_notebook_rag_ai;
pub mod submission_annotated_pdf;
pub mod syllabus_section_ai;
pub mod zip_import;
