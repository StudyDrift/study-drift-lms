.PHONY: test test-unit lint
COVERAGE_MIN?=90

test: test-coverage
test-coverage:
	# 90% gate for core packages; `internal/app` is a thin entry/orchestrator covered by `docker compose` e2e.
	go test ./... -count=1 -timeout=30m -coverprofile=coverage.out -covermode=atomic \
		-coverpkg=./internal/config,./internal/db,./internal/migrate,./internal/httpserver,./migrations
	go tool cover -html=coverage.out -o coverage.html
	@chmod +x ./scripts/check-coverage.sh
	@./scripts/check-coverage.sh $(COVERAGE_MIN) coverage.out

test-unit:
	GOFLAGS= go test ./... -count=1 -short

lint:
	golangci-lint run ./...
