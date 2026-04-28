package adaptivepath

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type StructurePathRuleRow struct {
	ID              uuid.UUID
	StructureItemID uuid.UUID
	RuleType        string
	ConceptIDs      []uuid.UUID
	Threshold       float64
	TargetItemID    *uuid.UUID
	Priority        int16
	CreatedAt       string
}

type EnrollmentPathOverrideRow struct {
	EnrollmentID uuid.UUID
	ItemSequence []uuid.UUID
	CreatedBy    uuid.UUID
	CreatedAt    string
}

func ListRulesForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]StructurePathRuleRow, error) {
	rows, err := pool.Query(ctx, `
SELECT r.id, r.structure_item_id, r.rule_type::text, r.concept_ids, (r.threshold)::float8, r.target_item_id, r.priority, r.created_at::text
FROM course.structure_item_path_rules r
INNER JOIN course.course_structure_items i ON i.id = r.structure_item_id
WHERE i.course_id = $1
ORDER BY r.structure_item_id, r.priority DESC, r.created_at ASC
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StructurePathRuleRow
	for rows.Next() {
		var r StructurePathRuleRow
		if err := rows.Scan(&r.ID, &r.StructureItemID, &r.RuleType, &r.ConceptIDs, &r.Threshold, &r.TargetItemID, &r.Priority, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func ListRulesForStructureItem(ctx context.Context, pool *pgxpool.Pool, courseID, structureItemID uuid.UUID) ([]StructurePathRuleRow, error) {
	rows, err := pool.Query(ctx, `
SELECT r.id, r.structure_item_id, r.rule_type::text, r.concept_ids, (r.threshold)::float8, r.target_item_id, r.priority, r.created_at::text
FROM course.structure_item_path_rules r
INNER JOIN course.course_structure_items i ON i.id = r.structure_item_id
WHERE i.course_id = $1 AND r.structure_item_id = $2
ORDER BY r.priority DESC, r.created_at ASC
`, courseID, structureItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StructurePathRuleRow
	for rows.Next() {
		var r StructurePathRuleRow
		if err := rows.Scan(&r.ID, &r.StructureItemID, &r.RuleType, &r.ConceptIDs, &r.Threshold, &r.TargetItemID, &r.Priority, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func InsertRule(ctx context.Context, pool *pgxpool.Pool, structureItemID uuid.UUID, ruleType string, conceptIDs []uuid.UUID, threshold float64, targetItemID *uuid.UUID, priority int16) (*StructurePathRuleRow, error) {
	var r StructurePathRuleRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.structure_item_path_rules (structure_item_id, rule_type, concept_ids, threshold, target_item_id, priority)
VALUES ($1, $2::course.path_rule_type, $3, $4, $5, $6)
RETURNING id, structure_item_id, rule_type::text, concept_ids, (threshold)::float8, target_item_id, priority, created_at::text
`, structureItemID, ruleType, conceptIDs, threshold, targetItemID, priority).Scan(
		&r.ID, &r.StructureItemID, &r.RuleType, &r.ConceptIDs, &r.Threshold, &r.TargetItemID, &r.Priority, &r.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func DeleteRuleForCourse(ctx context.Context, pool *pgxpool.Pool, courseID, ruleID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `
DELETE FROM course.structure_item_path_rules r
USING course.course_structure_items i
WHERE r.id = $1 AND r.structure_item_id = i.id AND i.course_id = $2
`, ruleID, courseID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func GetPathOverride(ctx context.Context, pool *pgxpool.Pool, enrollmentID uuid.UUID) (*EnrollmentPathOverrideRow, error) {
	var r EnrollmentPathOverrideRow
	err := pool.QueryRow(ctx, `
SELECT enrollment_id, item_sequence, created_by, created_at::text
FROM course.enrollment_path_overrides
WHERE enrollment_id = $1
`, enrollmentID).Scan(&r.EnrollmentID, &r.ItemSequence, &r.CreatedBy, &r.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func UpsertPathOverride(ctx context.Context, pool *pgxpool.Pool, enrollmentID uuid.UUID, itemSequence []uuid.UUID, createdBy uuid.UUID) error {
	_, err := pool.Exec(ctx, `
INSERT INTO course.enrollment_path_overrides (enrollment_id, item_sequence, created_by)
VALUES ($1, $2, $3)
ON CONFLICT (enrollment_id) DO UPDATE
SET item_sequence = EXCLUDED.item_sequence, created_by = EXCLUDED.created_by, created_at = NOW()
`, enrollmentID, itemSequence, createdBy)
	return err
}

func DeletePathOverride(ctx context.Context, pool *pgxpool.Pool, enrollmentID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM course.enrollment_path_overrides WHERE enrollment_id = $1`, enrollmentID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func InsertPathEvent(ctx context.Context, pool *pgxpool.Pool, enrollmentID uuid.UUID, fromItemID *uuid.UUID, toItemID uuid.UUID, ruleID *uuid.UUID, wasOverride bool, wasFallback bool) error {
	_, err := pool.Exec(ctx, `
INSERT INTO course.learner_path_events (enrollment_id, from_item_id, to_item_id, rule_id, was_override, was_fallback)
VALUES ($1, $2, $3, $4, $5, $6)
`, enrollmentID, fromItemID, toItemID, ruleID, wasOverride, wasFallback)
	return err
}
