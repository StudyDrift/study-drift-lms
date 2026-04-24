//! StudyDrift HTTP API library. The binary in `main.rs` is a thin wrapper around [`run`].

// Route handlers and service layers intentionally take more parameters than Clippy’s default;
// sqlx query shapes also produce very large `QueryAs` types. Keep `-D warnings` CI green without
// large mechanical refactors.
#![allow(clippy::too_many_arguments)]
#![allow(clippy::type_complexity)]

pub mod app;
pub mod authz;
pub mod config;
pub mod db;
pub mod error;
pub mod http_auth;
pub mod jwt;
pub mod lti_keys;
pub mod models;
pub mod openapi;
pub mod repos;
pub mod routes;
pub mod services;
pub mod state;

use crate::jwt::JwtSigner;
use crate::lti_keys::{LtiRsaKeyPair, LtiRuntime};
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
                    database checksum. Quick option: from the repo root run \
                    `python3 server/scripts/print_sqlx_checksum_update.py <version>` (e.g. `68`) \
                    and execute the printed `UPDATE` against the same `DATABASE_URL` as the app \
                    (or `python3 server/scripts/print_sqlx_checksum_update.py <version> --exec`). \
                    Alternatively: `sqlx migrate info` shows the local hex; then:\n  \
                    UPDATE _sqlx_migrations SET checksum = decode('<hex>', 'hex') WHERE version = <N>;\n\
                    (e.g. `docker compose exec postgres psql -U studydrift -d studydrift -c '...'`.)\n\
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

    let lti = match (
        config.lti_enabled,
        config.lti_rsa_private_key_pem.as_deref(),
    ) {
        (true, Some(pem)) => match LtiRsaKeyPair::from_pkcs8_pem(pem, &config.lti_rsa_key_id) {
            Ok(keys) => Some(Arc::new(LtiRuntime {
                enabled: true,
                api_base_url: config.lti_api_base_url.clone(),
                keys: Arc::new(keys),
            })),
            Err(e) => {
                tracing::error!(error = %e, "LTI RSA key invalid; LTI routes disabled");
                None
            }
        },
        (true, None) => {
            tracing::warn!(
                "LTI_ENABLED is set but LTI_RSA_PRIVATE_KEY_PEM is missing; LTI disabled"
            );
            None
        }
        _ => None,
    };

    let saml = if config.saml_sso_enabled {
        let Some(ref pem) = config.saml_sp_x509_pem else {
            unreachable!("SAML_SSO_ENABLED without cert should be rejected in Config::from_env");
        };
        Some(crate::state::SamlSpSettings {
            public_base_url: config.saml_public_base_url.clone(),
            sp_entity_id: config.saml_sp_entity_id.clone(),
            sp_x509_pem: pem.clone(),
            sp_private_key_pem: config.saml_sp_private_key_pem.clone(),
        })
    } else {
        None
    };

    let oidc = if config.oidc_sso_enabled {
        let http = openidconnect::reqwest::ClientBuilder::new()
            .redirect(openidconnect::reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| anyhow::anyhow!("OIDC HTTP client: {e}"))?;
        let google = match (
            config.oidc_google_client_id.as_ref(),
            config.oidc_google_client_secret.as_ref(),
        ) {
            (Some(id), Some(sec)) => Some((
                crate::state::OidcClientCredentials {
                    client_id: id.clone(),
                    client_secret: sec.clone(),
                },
                config.oidc_google_hd.clone(),
            )),
            _ => None,
        };
        let microsoft = match (
            config.oidc_microsoft_client_id.as_ref(),
            config.oidc_microsoft_client_secret.as_ref(),
        ) {
            (Some(id), Some(sec)) => Some((
                crate::state::OidcClientCredentials {
                    client_id: id.clone(),
                    client_secret: sec.clone(),
                },
                config.oidc_microsoft_tenant.clone(),
            )),
            _ => None,
        };
        let apple = match (
            config.oidc_apple_client_id.as_ref(),
            config.oidc_apple_team_id.as_ref(),
            config.oidc_apple_key_id.as_ref(),
            config.oidc_apple_private_key_pem.as_ref(),
        ) {
            (Some(cid), Some(team), Some(kid), Some(pem)) => Some(crate::state::AppleOidcCreds {
                client_id: cid.clone(),
                team_id: team.clone(),
                key_id: kid.clone(),
                private_key_pem: pem.clone(),
            }),
            _ => None,
        };
        Some(std::sync::Arc::new(crate::state::OidcState {
            public_base: config.oidc_public_base_url.clone(),
            http,
            google,
            microsoft,
            apple,
            metadata_cache: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        }))
    } else {
        None
    };

    Ok(AppState {
        pool,
        jwt,
        open_router,
        comm_events: comm_tx,
        feed_events: feed_tx,
        course_files_root,
        canvas_allowed_host_suffixes: config.canvas_allowed_host_suffixes.clone(),
        public_web_origin: config.public_web_origin.clone(),
        mail: crate::state::MailSettings {
            smtp_host: config.smtp_host.clone(),
            smtp_port: config.smtp_port,
            smtp_user: config.smtp_user.clone(),
            smtp_password: config.smtp_password.clone(),
            smtp_from: config.smtp_from.clone(),
        },
        lti,
        annotation_enabled: config.annotation_enabled,
        feedback_media_enabled: config.feedback_media_enabled,
        blind_grading_enabled: config.blind_grading_enabled,
        moderated_grading_enabled: config.moderated_grading_enabled,
        originality_detection_enabled: config.originality_detection_enabled,
        originality_stub_external: config.originality_stub_external,
        grade_posting_policies_enabled: config.grade_posting_policies_enabled,
        gradebook_csv_enabled: config.gradebook_csv_enabled,
        resubmission_workflow_enabled: config.resubmission_workflow_enabled,
        gradebook_import_pending: std::sync::Arc::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )),
        saml,
        oidc,
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
    let sweep_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            let now = chrono::Utc::now();
            match crate::services::quiz_auto_submit::sweep_expired_attempts(
                &sweep_state.pool,
                now,
                200,
            )
            .await
            {
                Ok(n) if n > 0 => tracing::info!(count = n, "auto-submit sweep completed"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "auto-submit sweep failed"),
            }
        }
    });
    let post_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            if !post_state.grade_posting_policies_enabled {
                continue;
            }
            let now = chrono::Utc::now();
            if let Err(e) =
                crate::services::grading::posting::sweep_scheduled_releases(&post_state.pool, now)
                    .await
            {
                tracing::warn!(error = %e, "grade_posting.sweep failed");
            }
        }
    });
    let app = app::router(state);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("StudyDrift API listening on {}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
