package course

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FactoryResetCourseOutcome struct {
	Course                       *CoursePublic
	RemovedCourseFileStorageKeys []string
}

// FactoryResetCourse matches Rust `course::factory_reset_course` behavior.
func FactoryResetCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string) (*FactoryResetCourseOutcome, error) {
	log.Printf("factory-reset: begin course=%q", courseCode)
	courseID, err := GetIDByCourseCode(ctx, pool, courseCode)
	if err != nil {
		log.Printf("factory-reset: load course id failed course=%q err=%v", courseCode, err)
		return nil, err
	}
	if courseID == nil {
		log.Printf("factory-reset: course not found course=%q", courseCode)
		return nil, nil
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Printf("factory-reset: begin tx failed course=%q err=%v", courseCode, err)
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err = execResetStep(ctx, tx, courseCode, "delete user_audit", `DELETE FROM "user".user_audit WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete course_learning_outcomes", `DELETE FROM course.course_learning_outcomes WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete discussion forums", `DELETE FROM course.discussion_forums WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete structure children", `DELETE FROM course.course_structure_items WHERE course_id = $1 AND parent_id IS NOT NULL`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete structure", `DELETE FROM course.course_structure_items WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete question_pools", `DELETE FROM course.question_pools WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete questions", `DELETE FROM course.questions WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}

	fileKeys, err := listStorageKeysForCourseFiles(ctx, tx, *courseID)
	if err != nil {
		log.Printf("factory-reset: list course file keys failed course=%q err=%v", courseCode, err)
		return nil, err
	}

	if err = execResetStep(ctx, tx, courseCode, "delete course_files", `DELETE FROM course.course_files WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete syllabus_acceptances", `DELETE FROM course.syllabus_acceptances WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete course_syllabus", `DELETE FROM course.course_syllabus WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete assignment_groups", `DELETE FROM course.assignment_groups WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete student_standard_proficiencies", `DELETE FROM course.student_standard_proficiencies WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete standard_sbg_alignments", `DELETE FROM course.standard_sbg_alignments WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}
	if err = execResetStep(ctx, tx, courseCode, "delete course_standards", `DELETE FROM course.course_standards WHERE course_id = $1`, *courseID); err != nil {
		return nil, err
	}

	if err = execResetStep(ctx, tx, courseCode, "insert default assignment_group", `
		INSERT INTO course.assignment_groups (course_id, sort_order, name, weight_percent)
		VALUES ($1, 0, 'Assignments', 100.0)
	`, *courseID); err != nil {
		return nil, err
	}

	_, err = tx.Exec(ctx, `
		UPDATE course.courses c
		SET
			published = false,
			archived = false,
			hero_image_url = NULL,
			hero_image_object_position = NULL,
			markdown_theme_preset = 'classic',
			markdown_theme_custom = NULL,
			grading_scale = 'letter_standard',
			notebook_enabled = true,
			feed_enabled = true,
			calendar_enabled = true,
			question_bank_enabled = false,
			lockdown_mode_enabled = false,
			standards_alignment_enabled = false,
			adaptive_paths_enabled = false,
			srs_enabled = false,
			diagnostic_assessments_enabled = false,
			hint_scaffolding_enabled = false,
			misconception_detection_enabled = false,
			discussions_enabled = false,
			collab_docs_enabled = false,
			sbg_enabled = false,
			sbg_proficiency_scale_json = NULL,
			sbg_aggregation_rule = 'most_recent',
			course_home_landing = 'data',
			course_home_content_item_id = NULL,
			updated_at = NOW()
		WHERE c.course_code = $1
	`, courseCode)
	if err != nil {
		log.Printf("factory-reset: update/reset course row failed course=%q err=%v", courseCode, err)
		return nil, err
	}

	if err = tx.Commit(ctx); err != nil {
		log.Printf("factory-reset: commit failed course=%q err=%v", courseCode, err)
		return nil, err
	}
	resetCourse, err := GetPublicByCourseCode(ctx, pool, courseCode)
	if err != nil {
		log.Printf("factory-reset: reload course row failed course=%q err=%v", courseCode, err)
		return nil, err
	}
	if resetCourse == nil {
		log.Printf("factory-reset: course missing after reset course=%q", courseCode)
		return nil, nil
	}
	log.Printf("factory-reset: committed course=%q file_keys=%d", courseCode, len(fileKeys))
	return &FactoryResetCourseOutcome{
		Course:                       resetCourse,
		RemovedCourseFileStorageKeys: fileKeys,
	}, nil
}

func execResetStep(ctx context.Context, tx pgx.Tx, courseCode, step, sql string, args ...any) error {
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		wrapped := fmt.Errorf("%s: %w", step, err)
		log.Printf("factory-reset: step failed course=%q step=%q err=%v", courseCode, step, err)
		return wrapped
	}
	return nil
}

func listStorageKeysForCourseFiles(ctx context.Context, tx pgx.Tx, courseID uuid.UUID) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT storage_key FROM course.course_files WHERE course_id = $1`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make([]string, 0)
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}
