package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/lextures/lextures/server/internal/db"
)

// TestNewHandler_ReadyWithPool hits defaultReady "happy path" (Ping) when a pool is configured.
func TestNewHandler_ReadyWithPool(t *testing.T) {
	if testing.Short() {
		t.Skip("requires DATABASE_URL")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("set DATABASE_URL for Postgres")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	p, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer p.Close()
	h := NewHandler(Deps{Pool: p})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("ready: %d body %s", rr.Code, rr.Body.String())
	}
}
