// Package oneroster implements OneRoster 1.2 CSV ingestion (plan 4.3) for the Go server.
package oneroster

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/user"
)

// CSVFile is one file from a OneRoster CSV bundle (UTF-8).
type CSVFile struct {
	Name string
	Data []byte
}

// SyncParams configures a sync run.
type SyncParams struct {
	InstitutionID uuid.UUID
	ActorUserID   uuid.UUID // created_by for new courses
	Trigger       string    // csv_upload | rest_push | scheduled
	Files         []CSVFile
}

type eventLogger func(entityType, op, sourcedID string, lextID *uuid.UUID, detail string)

// RunCSV ingests a OneRoster-style CSV bundle and returns the sync run id.
func RunCSV(ctx context.Context, pool *pgxpool.Pool, p SyncParams) (uuid.UUID, error) {
	if p.Trigger == "" {
		p.Trigger = "csv_upload"
	}
	tables := make(map[string][][]string, 8)
	headers := make(map[string][]string)
	for _, f := range p.Files {
		key := strings.ToLower(strings.TrimSpace(f.Name))
		if !strings.HasSuffix(key, ".csv") {
			continue
		}
		base := key[strings.LastIndex(key, "/")+1:]
		h, rows, err := parseCSV(base, bytes.NewReader(f.Data))
		if err != nil {
			return uuid.UUID{}, err
		}
		headers[base] = h
		tables[base] = rows
	}

	if _, ok := tables["users.csv"]; !ok {
		return uuid.UUID{}, ErrMissingColumn{File: "bundle", Column: "users.csv (file missing)"}
	}

	orgID, err := organization.ResolveOrgIDForProvisioning(ctx, pool, p.InstitutionID)
	if err != nil {
		return uuid.UUID{}, err
	}

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return uuid.UUID{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var runID uuid.UUID
	err = tx.QueryRow(ctx, `
INSERT INTO provisioning.oneroster_sync_runs (institution_id, trigger, status)
VALUES ($1, $2, 'running')
RETURNING id
`, p.InstitutionID, p.Trigger).Scan(&runID)
	if err != nil {
		return uuid.UUID{}, err
	}

	var created, updated, deactivated, nErr int

	logEvent := func(entityType, op, sourcedID string, lextID *uuid.UUID, detail string) {
		var lid any
		if lextID != nil {
			lid = *lextID
		}
		_, _ = tx.Exec(ctx, `
INSERT INTO provisioning.oneroster_sync_events (run_id, entity_type, operation, sourced_id, lextures_id, detail)
VALUES ($1, $2, $3, NULLIF($4,''), $5, NULLIF($6,''))
`, runID, entityType, op, sourcedID, lid, detail)
	}

	failRun := func(e error) (uuid.UUID, error) {
		_, _ = tx.Exec(ctx, `UPDATE provisioning.oneroster_sync_runs SET status = 'failed', completed_at = NOW(), error_message = $2 WHERE id = $1`, runID, e.Error())
		_ = tx.Commit(ctx)
		return runID, e
	}

	uHdr := headerIndex(headers["users.csv"])
	if _, err := requireCol(uHdr, "users.csv", "sourcedId"); err != nil {
		return failRun(err)
	}

	for _, rec := range tables["users.csv"] {
		sid := strings.TrimSpace(getCol(rec, uHdr, "sourcedId"))
		if sid == "" {
			nErr++
			logEvent("user", "error", "", nil, "empty sourcedId")
			continue
		}
		status := strings.ToLower(strings.TrimSpace(getCol(rec, uHdr, "status")))
		if status == "tobedeleted" {
			if err := deactivateUser(ctx, tx, p.InstitutionID, orgID, sid, logEvent, &deactivated); err != nil {
				nErr++
				logEvent("user", "error", sid, nil, err.Error())
			}
			continue
		}
		email := pickUserEmail(rec, uHdr, p.InstitutionID, sid)
		given := getCol(rec, uHdr, "givenName")
		family := getCol(rec, uHdr, "familyName")
		display := strings.TrimSpace(strings.TrimSpace(given) + " " + strings.TrimSpace(family))
		if display == "" {
			display = email
		}
		orRole := strings.ToLower(strings.TrimSpace(firstRole(getCol(rec, uHdr, "role"), getCol(rec, uHdr, "roles"))))

		op, err := upsertUser(ctx, tx, p.InstitutionID, orgID, sid, email, given, family, display, orRole, logEvent)
		if err != nil {
			nErr++
			logEvent("user", "error", sid, nil, err.Error())
			continue
		}
		switch op {
		case "create":
			created++
		case "update":
			updated++
		}
	}

	if rows, ok := tables["classes.csv"]; ok {
		cHdr := headerIndex(headers["classes.csv"])
		if _, err := requireCol(cHdr, "classes.csv", "sourcedId"); err != nil {
			return failRun(err)
		}
		for _, rec := range rows {
			sid := strings.TrimSpace(getCol(rec, cHdr, "sourcedId"))
			if sid == "" {
				continue
			}
			status := strings.ToLower(strings.TrimSpace(getCol(rec, cHdr, "status")))
			if status == "tobedeleted" {
				if err := deactivateClass(ctx, tx, p.InstitutionID, orgID, sid, logEvent, &deactivated); err != nil {
					nErr++
					logEvent("class", "error", sid, nil, err.Error())
				}
				continue
			}
			title := strings.TrimSpace(getCol(rec, cHdr, "title"))
			if title == "" {
				title = strings.TrimSpace(getCol(rec, cHdr, "classCode"))
			}
			if title == "" {
				title = "Class " + sid
			}
			op, err := upsertClassCourse(ctx, tx, p, orgID, sid, title, logEvent)
			if err != nil {
				nErr++
				logEvent("class", "error", sid, nil, err.Error())
				continue
			}
			switch op {
			case "create":
				created++
			case "update":
				updated++
			}
		}
	}

	if rows, ok := tables["enrollments.csv"]; ok {
		eHdr := headerIndex(headers["enrollments.csv"])
		for _, col := range []string{"sourcedId", "classSourcedId", "userSourcedId", "role"} {
			if _, err := requireCol(eHdr, "enrollments.csv", col); err != nil {
				return failRun(err)
			}
		}
		for _, rec := range rows {
			esid := strings.TrimSpace(getCol(rec, eHdr, "sourcedId"))
			cls := strings.TrimSpace(getCol(rec, eHdr, "classSourcedId"))
			us := strings.TrimSpace(getCol(rec, eHdr, "userSourcedId"))
			if cls == "" || us == "" {
				nErr++
				logEvent("enrollment", "error", esid, nil, "missing class or user sourcedId")
				continue
			}
			status := strings.ToLower(strings.TrimSpace(getCol(rec, eHdr, "status")))
			if status == "tobedeleted" {
				if err := deactivateEnrollment(ctx, tx, p.InstitutionID, orgID, esid, logEvent, &deactivated); err != nil {
					nErr++
					logEvent("enrollment", "error", esid, nil, err.Error())
				}
				continue
			}
			roleStr := strings.ToLower(strings.TrimSpace(getCol(rec, eHdr, "role")))
			enrollRole := mapEnrollmentRole(roleStr)
			op, err := upsertEnrollment(ctx, tx, p.InstitutionID, orgID, esid, cls, us, enrollRole, logEvent)
			if err != nil {
				nErr++
				logEvent("enrollment", "error", esid, nil, err.Error())
				continue
			}
			switch op {
			case "create":
				created++
			case "update":
				updated++
			}
		}
	}

	_, err = tx.Exec(ctx, `
UPDATE provisioning.oneroster_sync_runs
SET status = 'completed', completed_at = NOW(),
    created_count = $2, updated_count = $3, deactivated_count = $4, error_count = $5
WHERE id = $1
`, runID, created, updated, deactivated, nErr)
	if err != nil {
		return uuid.UUID{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.UUID{}, err
	}
	return runID, nil
}

func firstRole(role, roles string) string {
	if strings.TrimSpace(role) != "" {
		return role
	}
	for _, p := range strings.Split(roles, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			return p
		}
	}
	return ""
}

func pickUserEmail(rec []string, idx map[string]int, inst uuid.UUID, sourcedID string) string {
	em := strings.TrimSpace(getCol(rec, idx, "email"))
	if em != "" {
		return user.NormalizeEmail(em)
	}
	userName := strings.TrimSpace(getCol(rec, idx, "username"))
	if strings.Contains(userName, "@") {
		return user.NormalizeEmail(userName)
	}
	h := sha256.Sum256([]byte(inst.String() + "\x00" + sourcedID))
	local := "oneroster." + hex.EncodeToString(h[:12])
	return user.NormalizeEmail(local + "@provisioned.invalid")
}

func mapEnrollmentRole(r string) string {
	switch r {
	case "teacher":
		return "teacher"
	case "student":
		return "student"
	case "aide":
		return "instructor"
	case "administrator":
		return "teacher"
	default:
		return "student"
	}
}

func mapAppRoleName(orRole string) string {
	switch orRole {
	case "teacher":
		return "Teacher"
	case "student":
		return "Student"
	case "aide":
		return "TA"
	case "administrator":
		return "Global Admin"
	default:
		return "Student"
	}
}

func lookupMappedID(ctx context.Context, q pgx.Tx, inst uuid.UUID, entityType, sourcedID string) (*uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `
SELECT lextures_id FROM provisioning.oneroster_entity_mappings
WHERE institution_id = $1 AND entity_type = $2 AND sourced_id = $3
`, inst, entityType, sourcedID).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &id, nil
}

func upsertMapping(ctx context.Context, q pgx.Tx, inst uuid.UUID, entityType, sourcedID string, lexturesID uuid.UUID) error {
	_, err := q.Exec(ctx, `
INSERT INTO provisioning.oneroster_entity_mappings (institution_id, entity_type, sourced_id, lextures_id, last_synced_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (institution_id, entity_type, sourced_id)
DO UPDATE SET lextures_id = EXCLUDED.lextures_id, last_synced_at = NOW()
`, inst, entityType, sourcedID, lexturesID)
	return err
}
