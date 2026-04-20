use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

/// Machine-readable API error codes (JSON `error.code`). Human text stays in `error.message`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Unauthorized,
    NotFound,
    Forbidden,
    AiNotConfigured,
    AiGenerationFailed,
    InvalidCredentials,
    EmailTaken,
    InvalidInput,
    UnknownCourseCode,
    QuizSettingsInvalid,
    InvalidResetToken,
    TooManyRequests,
    QuestionAlreadyLocked,
    AttemptTimeExpired,
    MaxAttemptsReached,
    Internal,
}

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
    InvalidInput {
        code: ErrorCode,
        message: String,
    },
    #[error("invalid or expired password reset link")]
    InvalidResetToken,
    #[error("too many requests")]
    TooManyRequests(String),
    #[error("question already locked")]
    QuestionAlreadyLocked,
    #[error("attempt time expired")]
    AttemptTimeExpired,
    #[error("max quiz attempts reached")]
    MaxAttemptsReached,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

impl AppError {
    pub fn invalid_input(message: impl AsRef<str>) -> Self {
        Self::InvalidInput {
            code: ErrorCode::InvalidInput,
            message: message.as_ref().to_string(),
        }
    }

    pub fn invalid_input_code(code: ErrorCode, message: impl AsRef<str>) -> Self {
        Self::InvalidInput {
            code,
            message: message.as_ref().to_string(),
        }
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: ErrorCode,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::Unauthorized => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::Unauthorized,
                        message: "Sign in required.".into(),
                    },
                });
                (StatusCode::UNAUTHORIZED, body).into_response()
            }
            AppError::NotFound => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::NotFound,
                        message: "Resource not found.".into(),
                    },
                });
                (StatusCode::NOT_FOUND, body).into_response()
            }
            AppError::Forbidden => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::Forbidden,
                        message: "You do not have permission for this action.".into(),
                    },
                });
                (StatusCode::FORBIDDEN, body).into_response()
            }
            AppError::AiNotConfigured => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::AiNotConfigured,
                        message: "AI features are not configured on this server.".into(),
                    },
                });
                (StatusCode::SERVICE_UNAVAILABLE, body).into_response()
            }
            AppError::AiGenerationFailed(message) => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::AiGenerationFailed,
                        message,
                    },
                });
                (StatusCode::BAD_GATEWAY, body).into_response()
            }
            AppError::InvalidCredentials => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::InvalidCredentials,
                        message: "Invalid email or password.".into(),
                    },
                });
                (StatusCode::UNAUTHORIZED, body).into_response()
            }
            AppError::EmailTaken => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::EmailTaken,
                        message: "This email is already registered.".into(),
                    },
                });
                (StatusCode::CONFLICT, body).into_response()
            }
            AppError::InvalidInput { code, message } => {
                let body = Json(ErrorBody {
                    error: ErrorDetail { code, message },
                });
                (StatusCode::BAD_REQUEST, body).into_response()
            }
            AppError::InvalidResetToken => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::InvalidResetToken,
                        message: "This reset link is invalid or has expired. Request a new one from the sign-in page.".into(),
                    },
                });
                (StatusCode::BAD_REQUEST, body).into_response()
            }
            AppError::TooManyRequests(message) => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::TooManyRequests,
                        message,
                    },
                });
                (StatusCode::TOO_MANY_REQUESTS, body).into_response()
            }
            AppError::QuestionAlreadyLocked => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::QuestionAlreadyLocked,
                        message: "This question has already been submitted for this attempt.".into(),
                    },
                });
                (StatusCode::FORBIDDEN, body).into_response()
            }
            AppError::AttemptTimeExpired => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::AttemptTimeExpired,
                        message: "The quiz time limit has expired.".into(),
                    },
                });
                (StatusCode::FORBIDDEN, body).into_response()
            }
            AppError::MaxAttemptsReached => {
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::MaxAttemptsReached,
                        message: "No quiz attempts remaining for this quiz.".into(),
                    },
                });
                (StatusCode::FORBIDDEN, body).into_response()
            }
            AppError::Db(ref e) => {
                tracing::error!(error = %e, "database error");
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::Internal,
                        message: "Something went wrong.".into(),
                    },
                });
                (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
            }
            AppError::Jwt(ref e) => {
                tracing::error!(error = %e, "jwt error");
                let body = Json(ErrorBody {
                    error: ErrorDetail {
                        code: ErrorCode::Internal,
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
        let r = AppError::invalid_input("bad").into_response();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        let v = body_json(r).await;
        assert_eq!(v["error"]["code"], "INVALID_INPUT");
        assert_eq!(v["error"]["message"], "bad");
    }

    #[tokio::test]
    async fn invalid_input_custom_code() {
        let r = AppError::invalid_input_code(ErrorCode::UnknownCourseCode, "nope").into_response();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        let v = body_json(r).await;
        assert_eq!(v["error"]["code"], "UNKNOWN_COURSE_CODE");
        assert_eq!(v["error"]["message"], "nope");
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
            (AppError::AttemptTimeExpired, "ATTEMPT_TIME_EXPIRED"),
            (AppError::MaxAttemptsReached, "MAX_ATTEMPTS_REACHED"),
            (
                AppError::AiGenerationFailed("x".into()),
                "AI_GENERATION_FAILED",
            ),
            (AppError::InvalidCredentials, "INVALID_CREDENTIALS"),
            (AppError::EmailTaken, "EMAIL_TAKEN"),
            (AppError::InvalidResetToken, "INVALID_RESET_TOKEN"),
            (
                AppError::TooManyRequests("slow down".into()),
                "TOO_MANY_REQUESTS",
            ),
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

    #[tokio::test]
    async fn all_variants_status_codes() {
        let cases: Vec<(AppError, StatusCode)> = vec![
            (AppError::Unauthorized, StatusCode::UNAUTHORIZED),
            (AppError::NotFound, StatusCode::NOT_FOUND),
            (AppError::Forbidden, StatusCode::FORBIDDEN),
            (
                AppError::AiNotConfigured,
                StatusCode::SERVICE_UNAVAILABLE,
            ),
            (AppError::AiGenerationFailed("e".into()), StatusCode::BAD_GATEWAY),
            (AppError::InvalidCredentials, StatusCode::UNAUTHORIZED),
            (AppError::EmailTaken, StatusCode::CONFLICT),
            (AppError::invalid_input("x"), StatusCode::BAD_REQUEST),
            (
                AppError::invalid_input_code(ErrorCode::QuizSettingsInvalid, "x"),
                StatusCode::BAD_REQUEST,
            ),
            (AppError::InvalidResetToken, StatusCode::BAD_REQUEST),
            (
                AppError::TooManyRequests("x".into()),
                StatusCode::TOO_MANY_REQUESTS,
            ),
            (AppError::QuestionAlreadyLocked, StatusCode::FORBIDDEN),
            (AppError::AttemptTimeExpired, StatusCode::FORBIDDEN),
            (AppError::MaxAttemptsReached, StatusCode::FORBIDDEN),
            (
                AppError::Db(sqlx::Error::RowNotFound),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
            (
                AppError::Jwt(jsonwebtoken::errors::ErrorKind::InvalidToken.into()),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ];
        for (err, expected) in cases {
            let label = format!("{err:?}");
            let status = err.into_response().status();
            assert_eq!(status, expected, "{label}");
        }
    }
}
