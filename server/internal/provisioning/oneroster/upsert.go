package oneroster

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

func upsertUser(
	ctx context.Context, tx pgx.Tx,
	inst, orgID uuid.UUID, sourcedID, email, givenName, familyName, displayName, orRole string,
	log eventLogger,
) (op string, err error) {
	// orRole is the raw OneRoster role string (e.g. "teacher", "student", "aide").
	// We keep mapAppRoleName as a fallback display name for assignRoleTx but primarily
	// resolve through provisioning_role_map below.

	mappedUID, err := lookupMappedID(ctx, tx, inst, "user", sourcedID)
	if err != nil {
		return "", err
	}

	var emailRowID uuid.UUID
	var emailExists bool
	err = tx.QueryRow(ctx, `SELECT id FROM "user".users WHERE email = $1`, email).Scan(&emailRowID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			emailExists = false
		} else {
			return "", err
		}
	} else {
		emailExists = true
	}

	gn := strings.TrimSpace(givenName)
	fn := strings.TrimSpace(familyName)
	dn := strings.TrimSpace(displayName)
	if dn == "" {
		dn = email
	}

	if mappedUID != nil {
		var curEmail, curFn, curLn, curDn string
		var curDeactivated sql.NullTime
		var blocked bool
		err = tx.QueryRow(ctx, `
SELECT email, COALESCE(first_name,''), COALESCE(last_name,''), COALESCE(display_name,''), deactivated_at, login_blocked
FROM "user".users WHERE id = $1
`, *mappedUID).Scan(&curEmail, &curFn, &curLn, &curDn, &curDeactivated, &blocked)
		if err != nil {
			return "", err
		}
		changed := curFn != gn || curLn != fn || curDn != dn || curEmail != email
		if curDeactivated.Valid || blocked {
			_, _ = tx.Exec(ctx, `UPDATE "user".users SET deactivated_at = NULL, login_blocked = FALSE WHERE id = $1`, *mappedUID)
			changed = true
		}
		if changed {
			_, err = tx.Exec(ctx, `
UPDATE "user".users SET email = $2, first_name = NULLIF($3,''), last_name = NULLIF($4,''),
  display_name = NULLIF($5,''), org_id = $6
WHERE id = $1
`, *mappedUID, email, gn, fn, dn, orgID)
			if err != nil {
				return "", err
			}
			log("user", "update", sourcedID, mappedUID, "")
		} else {
			log("user", "skip", sourcedID, mappedUID, "")
		}
		if err := assignRoleTx(ctx, tx, *mappedUID, orRole); err != nil {
			return "", err
		}
		if changed {
			return "update", nil
		}
		return "", nil
	}

	if emailExists {
		var curFn, curLn, curDn sql.NullString
		err = tx.QueryRow(ctx, `SELECT first_name, last_name, display_name FROM "user".users WHERE id = $1`, emailRowID).Scan(&curFn, &curLn, &curDn)
		if err != nil {
			return "", err
		}
		curG := strings.TrimSpace(nullStr(curFn))
		curF := strings.TrimSpace(nullStr(curLn))
		curD := strings.TrimSpace(nullStr(curDn))
		profileSame := curG == gn && curF == fn && curD == dn
		if err := upsertMapping(ctx, tx, inst, "user", sourcedID, emailRowID); err != nil {
			return "", err
		}
		_, err = tx.Exec(ctx, `
UPDATE "user".users SET first_name = COALESCE(NULLIF($2,''), first_name),
  last_name = COALESCE(NULLIF($3,''), last_name),
  display_name = COALESCE(NULLIF($4,''), display_name),
  deactivated_at = NULL, login_blocked = FALSE,
  org_id = $5
WHERE id = $1
`, emailRowID, gn, fn, dn, orgID)
		if err != nil {
			return "", err
		}
		if err := assignRoleTx(ctx, tx, emailRowID, orRole); err != nil {
			return "", err
		}
		if profileSame {
			log("user", "skip", sourcedID, &emailRowID, "merged on email")
			return "", nil
		}
		log("user", "update", sourcedID, &emailRowID, "merged on email")
		return "update", nil
	}

	ph, err := authservice.PlaceholderPasswordHash()
	if err != nil {
		return "", err
	}
	var dnPtr *string
	if dn != "" {
		dnPtr = &dn
	}
	var newID uuid.UUID
	err = tx.QueryRow(ctx, `
INSERT INTO "user".users (email, password_hash, display_name, first_name, last_name, org_id)
VALUES ($1, $2, $3, NULLIF($4,''), NULLIF($5,''), $6)
RETURNING id
`, email, ph, dnPtr, gn, fn, orgID).Scan(&newID)
	if err != nil {
		return "", err
	}
	if err := upsertMapping(ctx, tx, inst, "user", sourcedID, newID); err != nil {
		return "", err
	}
	if err := assignRoleTx(ctx, tx, newID, orRole); err != nil {
		return "", err
	}
	log("user", "create", sourcedID, &newID, "")
	return "create", nil
}

func assignRoleTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, orRole string) error {
	// Resolve via provisioning_role_map; fall back to the app role implied by mapAppRoleName.
	_, err := rbac.AssignUserRoleFromProvisioningMapTx(ctx, tx, userID, "oneroster", orRole, mapAppRoleName(orRole))
	return err
}

func deactivateUser(ctx context.Context, tx pgx.Tx, inst, orgID uuid.UUID, sourcedID string, log eventLogger, deactivated *int) error {
	mappedUID, err := lookupMappedID(ctx, tx, inst, "user", sourcedID)
	if err != nil {
		return err
	}
	if mappedUID == nil {
		log("user", "skip", sourcedID, nil, "no mapping for tobedeleted")
		return nil
	}
	tag, err := tx.Exec(ctx, `
UPDATE "user".users SET deactivated_at = COALESCE(deactivated_at, NOW()), login_blocked = TRUE WHERE id = $1
`, *mappedUID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		*deactivated++
		log("user", "deactivate", sourcedID, mappedUID, "")
	}
	return nil
}

func upsertClassCourse(ctx context.Context, tx pgx.Tx, p SyncParams, orgID uuid.UUID, sourcedID, title string, log eventLogger) (string, error) {
	mapped, err := lookupMappedID(ctx, tx, p.InstitutionID, "class", sourcedID)
	if err != nil {
		return "", err
	}
	if mapped != nil {
		tag, err := tx.Exec(ctx, `
UPDATE course.courses SET title = $2, archived = FALSE, updated_at = NOW()
WHERE id = $1 AND org_id = $3 AND (title IS DISTINCT FROM $2 OR archived IS DISTINCT FROM FALSE)
`, *mapped, title, orgID)
		if err != nil {
			return "", err
		}
		if tag.RowsAffected() > 0 {
			log("class", "update", sourcedID, mapped, "")
			return "update", nil
		}
		log("class", "skip", sourcedID, mapped, "")
		return "", nil
	}

	for i := 0; i < 12; i++ {
		code, err := course.RandomCourseCode()
		if err != nil {
			return "", err
		}
		var cid uuid.UUID
		err = tx.QueryRow(ctx, `
INSERT INTO course.courses (course_code, title, description, course_type, created_by_user_id, org_id)
VALUES ($1, $2, '', 'traditional', $3, $4)
RETURNING id
`, code, title, p.ActorUserID, orgID).Scan(&cid)
		if err != nil {
			var pe *pgconn.PgError
			if errors.As(err, &pe) && pe.Code == "23505" {
				continue
			}
			return "", err
		}
		if err := upsertMapping(ctx, tx, p.InstitutionID, "class", sourcedID, cid); err != nil {
			return "", err
		}
		_, _ = tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role, active)
VALUES ($1, $2, 'teacher', TRUE)
ON CONFLICT (course_id, user_id, role) DO UPDATE SET active = TRUE
`, cid, p.ActorUserID)
		if err := course.SeedTeacherCourseGrants(ctx, tx, p.ActorUserID, cid, code); err != nil {
			return "", err
		}
		log("class", "create", sourcedID, &cid, "")
		return "create", nil
	}
	return "", errors.New("could not allocate unique course_code")
}

func deactivateClass(ctx context.Context, tx pgx.Tx, inst, orgID uuid.UUID, sourcedID string, log eventLogger, deactivated *int) error {
	mapped, err := lookupMappedID(ctx, tx, inst, "class", sourcedID)
	if err != nil {
		return err
	}
	if mapped == nil {
		return nil
	}
	tag, err := tx.Exec(ctx, `UPDATE course.courses SET archived = TRUE, updated_at = NOW() WHERE id = $1 AND org_id = $2`, *mapped, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		*deactivated++
		log("class", "deactivate", sourcedID, mapped, "")
	}
	return nil
}

func upsertEnrollment(ctx context.Context, tx pgx.Tx, inst, orgID uuid.UUID, enrollSID, classSID, userSID, enrollRole string, log eventLogger) (string, error) {
	classID, err := lookupMappedID(ctx, tx, inst, "class", classSID)
	if err != nil {
		return "", err
	}
	if classID == nil {
		return "", errors.New("unknown classSourcedId: import classes.csv first or before enrollments")
	}
	userID, err := lookupMappedID(ctx, tx, inst, "user", userSID)
	if err != nil {
		return "", err
	}
	if userID == nil {
		return "", errors.New("unknown userSourcedId")
	}
	var uOrg, cOrg uuid.UUID
	var uSt, cSt string
	if err := tx.QueryRow(ctx, `
SELECT u.org_id, o.status
FROM "user".users u
INNER JOIN tenant.organizations o ON o.id = u.org_id
WHERE u.id = $1
`, *userID).Scan(&uOrg, &uSt); err != nil {
		return "", err
	}
	if err := tx.QueryRow(ctx, `
SELECT c.org_id, o.status
FROM course.courses c
INNER JOIN tenant.organizations o ON o.id = c.org_id
WHERE c.id = $1
`, *classID).Scan(&cOrg, &cSt); err != nil {
		return "", err
	}
	if uOrg != cOrg || uSt != "active" || cSt != "active" {
		return "", errors.New("enrollment blocked: user and course must belong to the same active organization")
	}

	mappedEnroll, err := lookupMappedID(ctx, tx, inst, "enrollment", enrollSID)
	if err != nil {
		return "", err
	}
	if mappedEnroll != nil {
		var curRole string
		var active bool
		err = tx.QueryRow(ctx, `SELECT role, active FROM course.course_enrollments WHERE id = $1`, *mappedEnroll).Scan(&curRole, &active)
		if err != nil {
			return "", err
		}
		if curRole == enrollRole && active {
			log("enrollment", "skip", enrollSID, mappedEnroll, "")
			return "", nil
		}
		_, err = tx.Exec(ctx, `UPDATE course.course_enrollments SET role = $2, active = TRUE WHERE id = $1`, *mappedEnroll, enrollRole)
		if err != nil {
			return "", err
		}
		log("enrollment", "update", enrollSID, mappedEnroll, "")
		return "update", nil
	}

	var eid uuid.UUID
	err = tx.QueryRow(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role, active)
VALUES ($1, $2, $3, TRUE)
ON CONFLICT (course_id, user_id, role) DO UPDATE SET active = TRUE
RETURNING id
`, *classID, *userID, enrollRole).Scan(&eid)
	if err != nil {
		return "", err
	}
	if err := upsertMapping(ctx, tx, inst, "enrollment", enrollSID, eid); err != nil {
		return "", err
	}
	log("enrollment", "create", enrollSID, &eid, "")
	return "create", nil
}

func deactivateEnrollment(ctx context.Context, tx pgx.Tx, inst, orgID uuid.UUID, enrollSID string, log eventLogger, deactivated *int) error {
	mapped, err := lookupMappedID(ctx, tx, inst, "enrollment", enrollSID)
	if err != nil {
		return err
	}
	if mapped == nil {
		return nil
	}
	tag, err := tx.Exec(ctx, `
UPDATE course.course_enrollments ce
SET active = FALSE
FROM course.courses c
WHERE ce.id = $1 AND ce.course_id = c.id AND c.org_id = $2
`, *mapped, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		*deactivated++
		log("enrollment", "deactivate", enrollSID, mapped, "")
	}
	return nil
}

func nullStr(ns sql.NullString) string {
	if !ns.Valid {
		return ""
	}
	return ns.String
}
