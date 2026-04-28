# Common tasks for server-new. Run with DATABASE_URL for full tests (see CI).
.PHONY: test testshort lint build docker-build stubs
stubs:
	python3 scripts/gen_stubs.py
test:
	go test ./internal/... -count=1 -timeout=5m -coverprofile=coverage.out -covermode=atomic
	go tool cover -func=coverage.out | tail -1

testshort:
	go test ./... -count=1 -short -timeout=1m

lint:
	golangci-lint run ./...

build:
	go build -o bin/server ./cmd/server

docker-build:
	docker build -t lextures-server-go:local -f Dockerfile .
