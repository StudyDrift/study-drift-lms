use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    #[error("forbidden")]
    Forbidden,
    #[error("AI is not configured")]
    AiNotConfigured,
    #[error("AI generation failed: {0}")]
    AiGenerationFailed(String),
    #[error("invalid email or password")]
    InvalidCredentials,
    #[error("email already registered")]
    EmailTaken,
    #[error("invalid input")]
    InvalidInput(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::Unauthorized => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "UNAUTHORIZED",
                        message: "Sign in required.".into(),
                    },
                });
                (StatusCode::UNAUTHORIZED, body).into_response()
            }
            AppError::NotFound => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "NOT_FOUND",
                        message: "Resource not found.".into(),
                    },
                });
                (StatusCode::NOT_FOUND, body).into_response()
            }
            AppError::Forbidden => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "FORBIDDEN",
                        message: "You do not have permission for this action.".into(),
                    },
                });
                (StatusCode::FORBIDDEN, body).into_response()
            }
            AppError::AiNotConfigured => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "AI_NOT_CONFIGURED",
                        message: "AI features are not configured on this server.".into(),
                    },
                });
                (StatusCode::SERVICE_UNAVAILABLE, body).into_response()
            }
            AppError::AiGenerationFailed(message) => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "AI_GENERATION_FAILED",
                        message,
                    },
                });
                (StatusCode::BAD_GATEWAY, body).into_response()
            }
            AppError::InvalidCredentials => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "INVALID_CREDENTIALS",
                        message: "Invalid email or password.".into(),
                    },
                });
                (StatusCode::UNAUTHORIZED, body).into_response()
            }
            AppError::EmailTaken => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "EMAIL_TAKEN",
                        message: "This email is already registered.".into(),
                    },
                });
                (StatusCode::CONFLICT, body).into_response()
            }
            AppError::InvalidInput(message) => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "INVALID_INPUT",
                        message,
                    },
                });
                (StatusCode::BAD_REQUEST, body).into_response()
            }
            AppError::Db(ref e) => {
                tracing::error!(error = %e, "database error");
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "INTERNAL",
                        message: "Something went wrong.".into(),
                    },
                });
                (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
            }
            AppError::Jwt(ref e) => {
                tracing::error!(error = %e, "jwt error");
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: "INTERNAL",
                        message: "Something went wrong.".into(),
                    },
                });
                (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
            }
        }
    }
}
