# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
# samael (SAML): xmlsec1-config + bindgen (needs libclang for C headers).
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libxml2-dev \
    libxslt1-dev \
    libxmlsec1-dev \
    clang \
    libclang-dev \
    && rm -rf /var/lib/apt/lists/* \
    && test -x /usr/bin/xmlsec1-config
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY seeds ./seeds
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
# Dynamic libs linked by samael / xmlsec at build time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libxml2 \
    libxslt1.1 \
    libxmlsec1 \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/study_drift_server /app/study_drift_server
ENV RUST_LOG=info
EXPOSE 8080
USER nobody
CMD ["/app/study_drift_server"]
