use axum::{http::Method, routing::get, Router};
use tower_http::cors::{Any, CorsLayer};

use crate::routes;
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    Router::new()
        .route("/health", get(routes::health::get))
        .route("/health/ready", get(routes::health::ready))
        .merge(crate::openapi::swagger_router())
        .merge(routes::auth::router())
        .merge(routes::accommodations::router())
        .merge(routes::learners::router())
        .merge(routes::concepts::router())
        .merge(routes::me::router())
        .merge(routes::search::router())
        .merge(routes::courses::router())
        .merge(routes::question_bank::router())
        .merge(routes::surveys::router())
        .merge(routes::course_feed::router())
        .merge(routes::course_files::router())
        .merge(routes::settings::router())
        .merge(routes::rbac::router())
        .merge(routes::reports::router())
        .merge(routes::communication::router())
        .layer(cors)
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jwt::JwtSigner;
    use crate::state::AppState;
    use sqlx::PgPool;

    fn dummy_state(pool: PgPool) -> AppState {
        let jwt = JwtSigner::new("test");
        let (comm_tx, _rx) = tokio::sync::broadcast::channel(4);
        let (feed_tx, _frx) = tokio::sync::broadcast::channel(4);
        AppState {
            pool,
            jwt,
            open_router: None,
            comm_events: comm_tx,
            feed_events: feed_tx,
            course_files_root: std::path::PathBuf::from("data/course-files"),
            canvas_allowed_host_suffixes: vec!["instructure.com".into()],
            public_web_origin: "http://localhost:5173".into(),
            mail: crate::state::MailSettings {
                smtp_host: None,
                smtp_port: 587,
                smtp_user: None,
                smtp_password: None,
                smtp_from: None,
            },
        }
    }

    /// Router builds when given a pool (no connection required for graph construction).
    #[tokio::test]
    async fn router_constructs() {
        let pool = PgPool::connect_lazy("postgres://localhost/does_not_connect_yet").unwrap();
        let _ = router(dummy_state(pool));
    }
}
