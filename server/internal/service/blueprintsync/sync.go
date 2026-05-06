package blueprintsync

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursemodulequizzes"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
)

func structureItemCount(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM course.course_structure_items WHERE course_id = $1
	`, courseID).Scan(&n)
	return n, err
}

// LinkChildCourse validates org + blueprint flags, attaches parent id, and clones blueprint structure into an empty child.
func LinkChildCourse(ctx context.Context, pool *pgxpool.Pool, blueprintCourseID, childCourseID uuid.UUID) error {
	bpMeta, err := course.GetBlueprintMeta(ctx, pool, blueprintCourseID)
	if err != nil {
		return err
	}
	if !bpMeta.IsBlueprint {
		return fmt.Errorf("course is not designated as a blueprint")
	}
	chMeta, err := course.GetBlueprintMeta(ctx, pool, childCourseID)
	if err != nil {
		return err
	}
	if chMeta.OrgID != bpMeta.OrgID {
		return fmt.Errorf("blueprint and child must belong to the same organization")
	}
	if chMeta.IsBlueprint {
		return fmt.Errorf("a blueprint course cannot be linked as a child")
	}
	if chMeta.BlueprintParentID != nil {
		return fmt.Errorf("child course is already linked to a blueprint")
	}
	n, err := structureItemCount(ctx, pool, childCourseID)
	if err != nil {
		return err
	}
	if n > 0 {
		return fmt.Errorf("child course must have no module structure before linking (clear content first)")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE course.courses SET blueprint_parent_id = $2, updated_at = NOW() WHERE id = $1
	`, childCourseID, blueprintCourseID); err != nil {
		return err
	}

	if err := cloneBlueprintStructure(ctx, tx, pool, blueprintCourseID, childCourseID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	now := time.Now().UTC()
	if err := course.TouchBlueprintLastSync(ctx, pool, childCourseID, now); err != nil {
		return err
	}
	return nil
}

func remapAdaptiveSources(src []uuid.UUID, idMap map[uuid.UUID]uuid.UUID) []uuid.UUID {
	if len(src) == 0 {
		return nil
	}
	out := make([]uuid.UUID, 0, len(src))
	for _, x := range src {
		if u, ok := idMap[x]; ok {
			out = append(out, u)
		}
	}
	return out
}

func cloneBlueprintStructure(
	ctx context.Context, tx pgx.Tx, pool *pgxpool.Pool,
	blueprintCourseID, childCourseID uuid.UUID,
) error {
	rows, err := coursestructure.ListForCourse(ctx, pool, blueprintCourseID)
	if err != nil {
		return err
	}
	ordered := coursestructure.OrderRows(rows)
	idMap := make(map[uuid.UUID]uuid.UUID, len(ordered))
	for _, r := range ordered {
		var newParent *uuid.UUID
		if r.ParentID != nil {
			p, ok := idMap[*r.ParentID]
			if !ok {
				return fmt.Errorf("blueprintsync: broken parent chain for item %s", r.ID)
			}
			newParent = &p
		}
		newID := uuid.New()
		_, err := tx.Exec(ctx, `
			INSERT INTO course.course_structure_items (
				id, course_id, sort_order, kind, title, parent_id,
				published, visible_from, archived, due_at, assignment_group_id,
				blueprint_locked, blueprint_origin_id,
				created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6,
				$7, $8, $9, $10, NULL,
				true, $11,
				NOW(), NOW()
			)
		`, newID, childCourseID, r.SortOrder, r.Kind, r.Title, newParent,
			r.Published, r.VisibleFrom, r.Archived, r.DueAt, r.ID)
		if err != nil {
			return err
		}
		idMap[r.ID] = newID
	}

	// Extension rows + adaptive remap for quizzes.
	for _, r := range ordered {
		dst := idMap[r.ID]
		switch r.Kind {
		case "module", "heading":
			continue
		case "content_page":
			if _, err := tx.Exec(ctx, `
				INSERT INTO course.module_content_pages (structure_item_id, markdown, updated_at)
				SELECT $1::uuid, m.markdown, NOW()
				FROM course.module_content_pages m WHERE m.structure_item_id = $2
			`, dst, r.ID); err != nil {
				return err
			}
		case "assignment":
			if _, err := tx.Exec(ctx, copyAssignmentSQL, dst, r.ID); err != nil {
				return err
			}
		case "quiz":
			if _, err := tx.Exec(ctx, copyQuizSQL, dst, r.ID); err != nil {
				return err
			}
			qrow, err := coursemodulequizzes.GetForCourseItem(ctx, pool, blueprintCourseID, r.ID)
			if err != nil {
				return err
			}
			if qrow != nil && len(qrow.AdaptiveSourceItemIDs) > 0 {
				rem := remapAdaptiveSources(qrow.AdaptiveSourceItemIDs, idMap)
				b, err := json.Marshal(rem)
				if err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					UPDATE course.module_quizzes SET adaptive_source_item_ids = $2::jsonb, updated_at = NOW()
					WHERE structure_item_id = $1
				`, dst, b); err != nil {
					return err
				}
			}
		case "external_link":
			if _, err := tx.Exec(ctx, `
				INSERT INTO course.module_external_links (structure_item_id, url, updated_at)
				SELECT $1::uuid, m.url, NOW()
				FROM course.module_external_links m WHERE m.structure_item_id = $2
			`, dst, r.ID); err != nil {
				return err
			}
		case "survey":
			if _, err := tx.Exec(ctx, `
				INSERT INTO course.module_surveys (
					structure_item_id, description, anonymity_mode, opens_at, closes_at, questions_json, updated_at
				)
				SELECT $1::uuid, m.description, m.anonymity_mode, m.opens_at, m.closes_at, m.questions_json, NOW()
				FROM course.module_surveys m WHERE m.structure_item_id = $2
			`, dst, r.ID); err != nil {
				return err
			}
		case "lti_link":
			if _, err := tx.Exec(ctx, `
				INSERT INTO course.lti_resource_links (
					id, course_id, structure_item_id, external_tool_id, resource_link_id, title, custom_params, line_item_url, created_at
				)
				SELECT gen_random_uuid(), $1::uuid, $2::uuid, m.external_tool_id, m.resource_link_id, m.title, m.custom_params, m.line_item_url, NOW()
				FROM course.lti_resource_links m WHERE m.structure_item_id = $3
			`, childCourseID, dst, r.ID); err != nil {
				return err
			}
		default:
			return fmt.Errorf("blueprintsync: unsupported structure kind %q", r.Kind)
		}
	}
	return nil
}

// PushToAllChildren syncs blueprint content into every linked child course.
func PushToAllChildren(ctx context.Context, pool *pgxpool.Pool, blueprintCourseID, triggeredBy uuid.UUID) (total, okN, errN int, detail []map[string]any, err error) {
	log.Printf("blueprint_push_started blueprint_id=%s", blueprintCourseID)
	children, err := course.ListBlueprintChildren(ctx, pool, blueprintCourseID)
	if err != nil {
		return 0, 0, 0, nil, err
	}
	detail = make([]map[string]any, 0, len(children))
	okN = 0
	errN = 0
	for _, ch := range children {
		entry := map[string]any{"courseCode": ch.CourseCode}
		e := pushOneChild(ctx, pool, blueprintCourseID, ch.ID)
		if e != nil {
			errN++
			entry["ok"] = false
			entry["error"] = e.Error()
			log.Printf("blueprint_push_child_error blueprint_id=%s child=%s err=%v", blueprintCourseID, ch.CourseCode, e)
		} else {
			okN++
			entry["ok"] = true
			if err := course.TouchBlueprintLastSync(ctx, pool, ch.ID, time.Now().UTC()); err != nil {
				log.Printf("blueprint_push_child_warn blueprint_id=%s child=%s sync_ts_err=%v", blueprintCourseID, ch.CourseCode, err)
			}
		}
		detail = append(detail, entry)
	}
	log.Printf("blueprint_push_completed blueprint_id=%s children_total=%d success=%d errors=%d", blueprintCourseID, len(children), okN, errN)
	if err := course.InsertBlueprintSyncLog(ctx, pool, blueprintCourseID, triggeredBy, len(children), okN, errN, detail); err != nil {
		log.Printf("blueprint_push_log_insert_failed blueprint_id=%s err=%v", blueprintCourseID, err)
	}
	return len(children), okN, errN, detail, nil
}

func pushOneChild(ctx context.Context, pool *pgxpool.Pool, blueprintCourseID, childCourseID uuid.UUID) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := coursestructure.ListForCourse(ctx, pool, blueprintCourseID)
	if err != nil {
		return err
	}
	bpOrdered := coursestructure.OrderRows(rows)

	originToChild := make(map[uuid.UUID]uuid.UUID)
	originRows, err := tx.Query(ctx, `
		SELECT id, blueprint_origin_id FROM course.course_structure_items
		WHERE course_id = $1 AND blueprint_origin_id IS NOT NULL
	`, childCourseID)
	if err != nil {
		return err
	}
	defer originRows.Close()
	for originRows.Next() {
		var cid, oid uuid.UUID
		if err := originRows.Scan(&cid, &oid); err != nil {
			return err
		}
		originToChild[oid] = cid
	}
	if err := originRows.Err(); err != nil {
		return err
	}

	idMap := make(map[uuid.UUID]uuid.UUID)
	for k, v := range originToChild {
		idMap[k] = v
	}

	for _, r := range bpOrdered {
		childID, exists := originToChild[r.ID]
		if exists {
			if _, err := tx.Exec(ctx, `
				UPDATE course.course_structure_items SET
					title = $2,
					sort_order = $3,
					published = $4,
					archived = $5,
					due_at = $6,
					visible_from = $7,
					updated_at = NOW()
				WHERE id = $1 AND course_id = $8 AND blueprint_locked = true
			`, childID, r.Title, r.SortOrder, r.Published, r.Archived, r.DueAt, r.VisibleFrom, childCourseID); err != nil {
				return err
			}
			if err := replaceKindExtensions(ctx, tx, pool, blueprintCourseID, childCourseID, r.Kind, r.ID, childID, idMap); err != nil {
				return err
			}
			continue
		}

		var newParent *uuid.UUID
		if r.ParentID != nil {
			p, ok := idMap[*r.ParentID]
			if !ok {
				return fmt.Errorf("missing parent mapping for new item %s", r.ID)
			}
			newParent = &p
		}
		newID := uuid.New()
		if _, err := tx.Exec(ctx, `
			INSERT INTO course.course_structure_items (
				id, course_id, sort_order, kind, title, parent_id,
				published, visible_from, archived, due_at, assignment_group_id,
				blueprint_locked, blueprint_origin_id,
				created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6,
				$7, $8, $9, $10, NULL,
				true, $11,
				NOW(), NOW()
			)
		`, newID, childCourseID, r.SortOrder, r.Kind, r.Title, newParent,
			r.Published, r.VisibleFrom, r.Archived, r.DueAt, r.ID); err != nil {
			return err
		}
		idMap[r.ID] = newID
		originToChild[r.ID] = newID
		// copy extensions for brand-new row
		if err := cloneExtensionsForItem(ctx, tx, pool, blueprintCourseID, childCourseID, r.Kind, r.ID, newID, idMap); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func replaceKindExtensions(
	ctx context.Context, tx pgx.Tx, pool *pgxpool.Pool,
	bpCourseID, childCourseID uuid.UUID,
	kind string, bpItemID, childItemID uuid.UUID,
	idMap map[uuid.UUID]uuid.UUID,
) error {
	switch kind {
	case "module", "heading":
		return nil
	case "content_page":
		if _, err := tx.Exec(ctx, `DELETE FROM course.module_content_pages WHERE structure_item_id = $1`, childItemID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO course.module_content_pages (structure_item_id, markdown, updated_at)
			SELECT $1::uuid, m.markdown, NOW()
			FROM course.module_content_pages m WHERE m.structure_item_id = $2
		`, childItemID, bpItemID); err != nil {
			return err
		}
	case "assignment":
		if _, err := tx.Exec(ctx, `DELETE FROM course.module_assignments WHERE structure_item_id = $1`, childItemID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, copyAssignmentSQL, childItemID, bpItemID); err != nil {
			return err
		}
	case "quiz":
		if _, err := tx.Exec(ctx, `DELETE FROM course.module_quizzes WHERE structure_item_id = $1`, childItemID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, copyQuizSQL, childItemID, bpItemID); err != nil {
			return err
		}
		qrow, err := coursemodulequizzes.GetForCourseItem(ctx, pool, bpCourseID, bpItemID)
		if err != nil {
			return err
		}
		if qrow != nil && len(qrow.AdaptiveSourceItemIDs) > 0 {
			rem := remapAdaptiveSources(qrow.AdaptiveSourceItemIDs, idMap)
			b, err := json.Marshal(rem)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				UPDATE course.module_quizzes SET adaptive_source_item_ids = $2::jsonb, updated_at = NOW()
				WHERE structure_item_id = $1
			`, childItemID, b); err != nil {
				return err
			}
		}
	case "external_link":
		if _, err := tx.Exec(ctx, `DELETE FROM course.module_external_links WHERE structure_item_id = $1`, childItemID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO course.module_external_links (structure_item_id, url, updated_at)
			SELECT $1::uuid, m.url, NOW()
			FROM course.module_external_links m WHERE m.structure_item_id = $2
		`, childItemID, bpItemID); err != nil {
			return err
		}
	case "survey":
		if _, err := tx.Exec(ctx, `DELETE FROM course.module_surveys WHERE structure_item_id = $1`, childItemID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO course.module_surveys (
				structure_item_id, description, anonymity_mode, opens_at, closes_at, questions_json, updated_at
			)
			SELECT $1::uuid, m.description, m.anonymity_mode, m.opens_at, m.closes_at, m.questions_json, NOW()
			FROM course.module_surveys m WHERE m.structure_item_id = $2
		`, childItemID, bpItemID); err != nil {
			return err
		}
	case "lti_link":
		if _, err := tx.Exec(ctx, `DELETE FROM course.lti_resource_links WHERE structure_item_id = $1`, childItemID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO course.lti_resource_links (
				id, course_id, structure_item_id, external_tool_id, resource_link_id, title, custom_params, line_item_url, created_at
			)
			SELECT gen_random_uuid(), $1::uuid, $2::uuid, m.external_tool_id, m.resource_link_id, m.title, m.custom_params, m.line_item_url, NOW()
			FROM course.lti_resource_links m WHERE m.structure_item_id = $3
		`, childCourseID, childItemID, bpItemID); err != nil {
			return err
		}
	default:
		return fmt.Errorf("replace extensions: unsupported kind %q", kind)
	}
	return nil
}

func cloneExtensionsForItem(
	ctx context.Context, tx pgx.Tx, pool *pgxpool.Pool,
	bpCourseID, childCourseID uuid.UUID,
	kind string, bpItemID, newChildItemID uuid.UUID,
	idMap map[uuid.UUID]uuid.UUID,
) error {
	return replaceKindExtensions(ctx, tx, pool, bpCourseID, childCourseID, kind, bpItemID, newChildItemID, idMap)
}
