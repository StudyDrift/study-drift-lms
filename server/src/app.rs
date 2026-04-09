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
        .merge(routes::auth::router())
        .merge(routes::me::router())
        .merge(routes::search::router())
        .merge(routes::courses::router())
        .merge(routes::settings::router())
        .merge(routes::rbac::router())
        .merge(routes::reports::router())
        .merge(routes::communication::router())
        .layer(cors)
        .with_state(state)
}
