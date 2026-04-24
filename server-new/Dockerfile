# Build stage
FROM golang:1.24-alpine AS builder
RUN apk add --no-cache ca-certificates git
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download || go mod tidy
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lextures-server ./cmd/lextures-server

# Runtime
FROM gcr.io/distroless/base-debian12:nonroot
USER nonroot:nonroot
WORKDIR /app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /out/lextures-server /app/lextures-server
ENV GODEBUG=netdns=go
EXPOSE 8080
ENTRYPOINT ["/app/lextures-server"]
