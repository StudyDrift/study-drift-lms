package httpserver

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
)

func assertCanReadLearnerState(ctx context.Context, pool *pgxpool.Pool, viewer, target uuid.UUID) (bool, error) {
	if viewer == target {
		return true, nil
	}
	return enrollment.StaffSeesStudentInSharedCourse(ctx, pool, viewer, target)
}

func writeLearnerAccessDenied(w http.ResponseWriter) {
	apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
}
