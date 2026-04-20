//! OpenAPI document and Swagger UI (`/api/docs`, `/api/openapi.json`).
//!
//! Handlers gain `#[utoipa::path]` over time; the document grows with them.

use axum::Router;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::state::AppState;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "StudyDrift API",
        description = "Lextures LMS HTTP API. Generate TypeScript types: `npx openapi-typescript http://localhost:8080/api/openapi.json -o src/lib/api-types.generated.ts` (with the API running).",
        version = "0.1.0",
    ),
    paths(crate::routes::health::get),
    tags((name = "meta", description = "Health and API metadata"))
)]
pub struct ApiDoc;

pub fn swagger_router() -> Router<AppState> {
    SwaggerUi::new("/api/docs")
        .url("/api/openapi.json", ApiDoc::openapi())
        .into()
}
