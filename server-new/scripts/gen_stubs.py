#!/usr/bin/env python3
"""Create doc.go-only stub packages for migration.md repo/service/model coverage."""
from __future__ import annotations

import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Remaining internal/repos (server/src/repos/*) not yet in Go. Directory → package name.
REPOS: list[tuple[str, str, str]] = [
    ("adaptivepath", "adaptivepath", "repos/adaptive_path"),
    ("concepts", "concepts", "repos/concepts"),
    ("contentpagemarkups", "contentpagemarkups", "repos/content_page_markups"),
    ("coursefeed", "coursefeed", "repos/course_feed"),
    ("coursefiles", "coursefiles", "repos/course_files"),
    ("coursegrades", "coursegrades", "repos/course_grades"),
    ("coursegrading", "coursegrading", "repos/course_grading"),
    ("coursemoduleassignments", "coursemoduleassignments", "repos/course_module_assignments"),
    ("coursemodulecontent", "coursemodulecontent", "repos/course_module_content"),
    ("coursemoduleexternallinks", "coursemoduleexternallinks", "repos/course_module_external_links"),
    ("coursemodulequizzes", "coursemodulequizzes", "repos/course_module_quizzes"),
    ("coursemodulesurveys", "coursemodulesurveys", "repos/course_module_surveys"),
    ("courseoutcomes", "courseoutcomes", "repos/course_outcomes"),
    ("coursestructure", "coursestructure", "repos/course_structure"),
    ("coursesyllabus", "coursesyllabus", "repos/course_syllabus"),
    ("diagnostic", "diagnostic", "repos/diagnostic"),
    ("enrollmentgroups", "enrollmentgroups", "repos/enrollment_groups"),
    ("enrollmentquizzesoverrides", "enrollmentquizzesoverrides", "repos/enrollment_quiz_overrides"),
    ("feedbackmedia", "feedbackmedia", "repos/feedback_media"),
    ("gradeauditevents", "gradeauditevents", "repos/grade_audit_events"),
    ("gradingschemes", "gradingschemes", "repos/grading_schemes"),
    ("hints", "hints", "repos/hints"),
    ("learnermodel", "learnermodel", "repos/learner_model"),
    ("lti", "ltidb", "repos/lti"),
    ("misconceptions", "misconceptions", "repos/misconceptions"),
    ("moderatedgrading", "moderatedgrading", "repos/moderated_grading"),
    ("moduleassignmentsubmissions", "moduleassignmentsubmissions", "repos/module_assignment_submissions"),
    ("provisionalgrades", "provisionalgrades", "repos/provisional_grades"),
    ("qtiimport", "qtiimport", "repos/qti_import"),
    ("questionbank", "questionbank", "repos/question_bank"),
    ("quizattempts", "quizattempts", "repos/quiz_attempts"),
    ("recommendations", "recommendations", "repos/recommendations"),
    ("sbg", "sbg", "repos/sbg"),
    ("srs", "srs", "repos/srs"),
    ("standards", "standards", "repos/standards"),
    ("submissionannotations", "submissionannotations", "repos/submission_annotations"),
    ("submissionversions", "submissionversions", "repos/submission_versions"),
    ("syllabusacceptance", "syllabusacceptance", "repos/syllabus_acceptance"),
    ("syllabusmarkups", "syllabusmarkups", "repos/syllabus_markups"),
    ("systemprompts", "systemprompts", "repos/system_prompts"),
]

SERVICES = [
    "adaptivepath", "adaptivequizai", "adaptivequizcat", "assignmentrubricai", "canvascourseimport",
    "codeexecution", "commoncartridge", "competencygating", "conceptgraph", "courseexportimport",
    "courseimageupload", "diagnostic", "enrollments", "feedbackmedia", "feedbackmediacaption", "grading",
    "hintservice", "irttheta", "learnerstate", "lti", "ltijwt", "mailservice", "masterytranscriptpdf", "misconception",
    "moderatedgrading", "originality", "outcomes", "qtiimport", "qtiparser", "questionbank",
    "quizattempt", "quizattemptgrading", "quizsubmissions", "quizautosubmit", "quizlockdown", "quizgenerationai",
    "recommendations", "relativeschedule", "settingsops", "srs", "srsscheduler", "standards", "submissionannotatedpdf",
    "syllabussectionai", "zipimport", "irt", "irtcalibrationjob",
]

# Remove duplicates, skip existing
EXISTING_SVC = {"accommodations", "oidcauth", "authservice", "irtcalibration", "notebookrag", "openrouter", "meperm"}

# Models: internal/models subpackages from §5 not yet present
MODEL_PKGS: list[str] = [
    "adaptivepath", "assignmentrubric", "auth", "contentpagemarkups", "course", "courseexport",
    "coursefeed", "coursefile", "coursegradebook", "coursegrading", "coursemoduleassignment", "coursemodulecontent",
    "coursemodulequiz", "coursemodulesurvey", "courseoutcomesapi", "coursestructure", "coursesyllabus",
    "enrollment", "enrollmentgroup", "gradingscheme", "latesubmissionpolicy", "me", "questionbank", "sbg",
    "settingsaccount", "settingsai", "settingssystemprompts", "standards", "studentnotebookrag",
]
EXISTING_MODELS = {
    "accommodations", "search", "reports", "rbac", "useraudit", "communication",
}

def write_if_absent(rel: Path, d: str, pkg: str, rust: str) -> None:
    f = rel / d / "doc.go"
    if f.exists():
        return
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        textwrap.dedent(
            f"""
            // Package {pkg} is a placeholder for a port of {rust} (see server-new/migration.md).
            // Types and query helpers are added as handlers are implemented.
            package {pkg}
            """
        ).lstrip()
    )


def main() -> None:
    for d, pkg, rust in REPOS:
        write_if_absent(ROOT / "internal" / "repos", d, pkg, rust)
    for name in SERVICES:
        if name in EXISTING_SVC:
            continue
        if (ROOT / "internal" / "service" / name).exists():
            continue
        write_if_absent(ROOT / "internal" / "service", name, name, f"server/src/services/{name}/")
    for name in MODEL_PKGS:
        if name in EXISTING_MODELS:
            continue
        if (ROOT / "internal" / "models" / name).exists():
            continue
        write_if_absent(ROOT / "internal" / "models", name, name, f"server/src/models/{name}.rs")


if __name__ == "__main__":
    main()
