# Rust → Go migration (status)

The long-form gap audit that previously lived in this file has been **partially implemented** in `server-new/` (2026-04-29):

- **Background jobs:** quiz **auto-submit** sweep (`internal/service/quizautosubmit`, `internal/background`), **scheduled grade release** sweep (`internal/background/grade_sweep.go` + repos), and the admin **IRT 2PL calibration** run (`internal/service/irtcalibration/background.go`, `internal/repos/questionbank/irt_calibration.go`).
- **CLI:** `server-new/cmd/migrate-question-bank` — same behavior as `server/src/bin/migrate_question_bank.rs`, using `questionbank.SyncQuizRefsFromEditorJSON`.

**Known Go gap vs Rust for auto-submit:** non-adaptive attempts do not yet run `learner_state::apply_mastery_from_saved_responses`; attempts are still finalized with correct scored points.

**Still open** (unchanged in scope from the old audit): stub-only services, ~90+ HTTP routes, SAML/LTI production depth, most transactional mail, full repo/model parity, integration/E2E tests, deploy image cutover. Use `**server-new/migration.md`** as the living checklist and diff against `server/` for behavior.