//! Plagiarism / AI-content originality signals (plan 3.5).

pub mod internal;
pub mod job;
pub mod policy;
pub mod storage;
pub mod text_extract;

pub use job::spawn_originality_detection_job;
