// StudyDrift API (Go) — in-progress port of the legacy Rust service.
package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	serverdata "github.com/lextures/lextures/server-new"
	"github.com/lextures/lextures/server-new/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := app.Run(ctx, serverdata.Migrations); err != nil {
		log.Fatal(err)
	}
}
