//! StudyDrift HTTP API library. The binary in `main.rs` is a thin wrapper around [`run`].

pub mod app;
pub mod authz;
pub mod config;
pub mod db;
pub mod error;
pub mod http_auth;
pub mod jwt;
pub mod models;
pub mod repos;
pub mod routes;
pub mod services;
pub mod state;

use crate::jwt::JwtSigner;
use crate::services::ai::OpenRouterClient;
use crate::state::AppState;
use std::sync::Arc;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Loads `./server/.env` (repo root cwd) then `.env` in cwd. Call before [`build_app_state_from_env`] or [`run`].
pub fn load_dotenv() {
    let _ = dotenvy::from_path(std::path::Path::new("server/.env")).ok();
    dotenvy::dotenv().ok();
}

/// Connects to Postgres, applies migrations when enabled, and builds [`AppState`]. Used by integration tests and by [`run`].
pub async fn build_app_state_from_env() -> anyhow::Result<AppState> {
    let config = config::Config::from_env()?;
    tracing::info!(
        run_migrations = config.run_migrations,
        raw_run_migrations_env = ?std::env::var("RUN_MIGRATIONS").ok(),
        "migration configuration"
    );
    let pool = db::connect(&config.database_url).await?;

    if config.run_migrations {
        db::run_migrations(&pool).await.map_err(|e| {
            let msg = e.to_string();
            if msg.contains("has been modified") {
                anyhow::anyhow!(
                    "{msg}\n\n\
                    This happens when a migration file was edited after it was already applied. \
                    If the current SQL in `server/migrations/` is the source of truth, align the \
                    database: run `sqlx migrate info` (same DATABASE_URL as the app) to see the \
                    version and the local checksum, then update `_sqlx_migrations`:\n  \
                    UPDATE _sqlx_migrations SET checksum = decode('<local hex from info>', 'hex') WHERE version = <N>;\n\
                    (From the host with Postgres on localhost:5432, or `docker compose exec postgres psql -U studydrift -d studydrift -c '...'`.)\n\
                    Install the CLI: cargo install sqlx-cli --no-default-features --features rustls,postgres"
                )
            } else {
                anyhow::anyhow!("SQLx migrations failed: {e}")
            }
        })?;
        tracing::info!("database migrations applied successfully");
    } else {
        tracing::warn!(
            "RUN_MIGRATIONS is disabled; skipping migrations (schema may be out of date)"
        );
    }

    let jwt = JwtSigner::new(&config.jwt_secret);

    let open_router = config
        .open_router_api_key
        .clone()
        .map(|key| Arc::new(OpenRouterClient::new(key)));
    if open_router.is_none() {
        tracing::warn!(
            "OPENROUTER_API_KEY (or OPEN_ROUTER_API_KEY) not set; AI image generation is disabled"
        );
    }

    let (comm_tx, _comm_rx) = tokio::sync::broadcast::channel(256);
    let (feed_tx, _feed_rx) = tokio::sync::broadcast::channel(512);

    let course_files_root = config.course_files_root.clone();
    if let Err(e) = tokio::fs::create_dir_all(&course_files_root).await {
        tracing::warn!(
            path = %course_files_root.display(),
            error = %e,
            "could not create course files root directory"
        );
    } else {
        tracing::info!(
            path = %course_files_root.display(),
            "course files storage directory ready"
        );
    }

    Ok(AppState {
        pool,
        jwt,
        open_router,
        comm_events: comm_tx,
        feed_events: feed_tx,
        course_files_root,
    })
}

/// Loads configuration, connects to Postgres, applies migrations when enabled, and serves the API on `:8080`.
pub async fn run() -> anyhow::Result<()> {
    load_dotenv();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let state = build_app_state_from_env().await?;
    let app = app::router(state);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("StudyDrift API listening on {}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
