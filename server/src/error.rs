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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::{IntoResponse, Response};
    use http_body_util::BodyExt;

    async fn body_json(resp: Response) -> serde_json::Value {
        let b = resp.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&b).unwrap()
    }

    #[tokio::test]
    async fn unauthorized_json_shape() {
        let r = AppError::Unauthorized.into_response();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        let v = body_json(r).await;
        assert_eq!(v["error"]["code"], "UNAUTHORIZED");
    }

    #[tokio::test]
    async fn invalid_input_carries_message() {
        let r = AppError::InvalidInput("bad".into()).into_response();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        let v = body_json(r).await;
        assert_eq!(v["error"]["code"], "INVALID_INPUT");
        assert_eq!(v["error"]["message"], "bad");
    }

    #[tokio::test]
    async fn ai_not_configured_is_503() {
        let r = AppError::AiNotConfigured.into_response();
        assert_eq!(r.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn db_error_maps_to_500() {
        let r = AppError::Db(sqlx::Error::RowNotFound).into_response();
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn forbidden_not_found_and_ai_errors() {
        for (err, code) in [
            (AppError::Forbidden, "FORBIDDEN"),
            (AppError::NotFound, "NOT_FOUND"),
            (
                AppError::AiGenerationFailed("x".into()),
                "AI_GENERATION_FAILED",
            ),
            (AppError::InvalidCredentials, "INVALID_CREDENTIALS"),
            (AppError::EmailTaken, "EMAIL_TAKEN"),
        ] {
            let r = err.into_response();
            let v = body_json(r).await;
            assert_eq!(v["error"]["code"], code);
        }
    }

    #[tokio::test]
    async fn jwt_error_maps_to_500() {
        let r = AppError::Jwt(jsonwebtoken::errors::ErrorKind::InvalidToken.into()).into_response();
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
