package oneroster

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WriteUsersCollectionJSON is GET /oneroster/v1p2/users — IMS-like collection from synced mappings.
func WriteUsersCollectionJSON(ctx context.Context, w http.ResponseWriter, pool *pgxpool.Pool, institutionID uuid.UUID) error {
	rows, err := pool.Query(ctx, `
SELECT m.sourced_id, u.email, COALESCE(u.first_name,''), COALESCE(u.last_name,''),
       (u.login_blocked OR u.deactivated_at IS NOT NULL)
FROM provisioning.oneroster_entity_mappings m
INNER JOIN "user".users u ON u.id = m.lextures_id
WHERE m.institution_id = $1 AND m.entity_type = 'user'
ORDER BY m.sourced_id
`, institutionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type uOut struct {
		SourcedID  string `json:"sourcedId"`
		Status     string `json:"status"`
		GivenName  string `json:"givenName,omitempty"`
		FamilyName string `json:"familyName,omitempty"`
		Email      string `json:"email,omitempty"`
	}
	var users []uOut
	for rows.Next() {
		var sid, email, gn, fn string
		var blocked bool
		if err := rows.Scan(&sid, &email, &gn, &fn, &blocked); err != nil {
			return err
		}
		st := "active"
		if blocked {
			st = "tobedeleted"
		}
		users = append(users, uOut{SourcedID: sid, Status: st, GivenName: gn, FamilyName: fn, Email: email})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(map[string]any{"users": users})
}

// WriteClassesCollectionJSON is GET /oneroster/v1p2/classes.
func WriteClassesCollectionJSON(ctx context.Context, w http.ResponseWriter, pool *pgxpool.Pool, institutionID uuid.UUID) error {
	rows, err := pool.Query(ctx, `
SELECT m.sourced_id, c.title, c.archived
FROM provisioning.oneroster_entity_mappings m
INNER JOIN course.courses c ON c.id = m.lextures_id
WHERE m.institution_id = $1 AND m.entity_type = 'class'
ORDER BY m.sourced_id
`, institutionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type cOut struct {
		SourcedID string `json:"sourcedId"`
		Status    string `json:"status"`
		Title     string `json:"title,omitempty"`
	}
	var classes []cOut
	for rows.Next() {
		var sid, title string
		var arch bool
		if err := rows.Scan(&sid, &title, &arch); err != nil {
			return err
		}
		st := "active"
		if arch {
			st = "tobedeleted"
		}
		classes = append(classes, cOut{SourcedID: sid, Status: st, Title: title})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(map[string]any{"classes": classes})
}

// WriteEnrollmentsCollectionJSON is GET /oneroster/v1p2/enrollments.
func WriteEnrollmentsCollectionJSON(ctx context.Context, w http.ResponseWriter, pool *pgxpool.Pool, institutionID uuid.UUID) error {
	rows, err := pool.Query(ctx, `
SELECT me.sourced_id, mc.sourced_id, mu.sourced_id, ce.role, ce.active
FROM provisioning.oneroster_entity_mappings me
INNER JOIN course.course_enrollments ce ON ce.id = me.lextures_id
INNER JOIN provisioning.oneroster_entity_mappings mc
  ON mc.institution_id = me.institution_id AND mc.entity_type = 'class' AND mc.lextures_id = ce.course_id
INNER JOIN provisioning.oneroster_entity_mappings mu
  ON mu.institution_id = me.institution_id AND mu.entity_type = 'user' AND mu.lextures_id = ce.user_id
WHERE me.institution_id = $1 AND me.entity_type = 'enrollment'
ORDER BY me.sourced_id
`, institutionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type eOut struct {
		SourcedID       string `json:"sourcedId"`
		ClassSourcedID  string `json:"classSourcedId"`
		UserSourcedID   string `json:"userSourcedId"`
		Role            string `json:"role"`
		Status          string `json:"status"`
	}
	var enrollments []eOut
	for rows.Next() {
		var esid, csid, usid, role string
		var active bool
		if err := rows.Scan(&esid, &csid, &usid, &role, &active); err != nil {
			return err
		}
		st := "active"
		if !active {
			st = "tobedeleted"
		}
		enrollments = append(enrollments, eOut{
			SourcedID: esid, ClassSourcedID: csid, UserSourcedID: usid, Role: role, Status: st,
		})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(map[string]any{"enrollments": enrollments})
}

// WriteOrgsCollectionJSON is GET /oneroster/v1p2/orgs (stub for single-tenant sync).
func WriteOrgsCollectionJSON(w http.ResponseWriter, institutionID uuid.UUID) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(map[string]any{
		"orgs": []map[string]string{{
			"sourcedId": institutionID.String(),
			"name":      "Institution",
			"type":      "district",
			"status":    "active",
		}},
	})
}

// WriteEmptyJSONArrayJSON writes {"academicSessions":[]} or {"gradingPeriods":[]}.
func WriteEmptyJSONArrayJSON(w http.ResponseWriter, key string) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(map[string]any{key: []any{}})
}
