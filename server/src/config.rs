use std::env;
use std::path::PathBuf;

/// Minimum length for `JWT_SECRET` (after trim). Shorter values are rejected to avoid weak
/// production deployments; use `ALLOW_INSECURE_JWT=1` only for local/tests with a missing secret.
pub const JWT_SECRET_MIN_LEN: usize = 32;

const INSECURE_JWT_FALLBACK: &str = "dev-secret-do-not-use-in-production";

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub run_migrations: bool,
    /// OpenRouter API key for AI features (image generation, etc.). Empty disables AI calls.
    pub open_router_api_key: Option<String>,
    /// Root directory for per-course uploaded files (images, etc.). Override with `COURSE_FILES_ROOT`.
    pub course_files_root: PathBuf,
    /// Allowed Canvas base URL host suffixes (e.g. `instructure.com`).
    /// Override with `CANVAS_ALLOWED_HOST_SUFFIXES` as a comma-separated list.
    pub canvas_allowed_host_suffixes: Vec<String>,
    /// Base URL of the web app (no trailing slash). Used in password-reset emails. Default: `http://localhost:5173`.
    pub public_web_origin: String,
    /// SMTP host for outbound mail. When unset, password-reset links are only logged (development).
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_user: Option<String>,
    pub smtp_password: Option<String>,
    /// RFC 5322 From address for transactional mail (required for real delivery when SMTP is set).
    pub smtp_from: Option<String>,
    /// When true and `LTI_RSA_PRIVATE_KEY_PEM` is set, LTI 1.3 routes are active.
    pub lti_enabled: bool,
    /// Public base URL of this API (no trailing slash), e.g. `https://api.example.com`. Used as LTI platform issuer.
    pub lti_api_base_url: String,
    /// PKCS#8 PEM RSA private key for LTI RS256 signing.
    pub lti_rsa_private_key_pem: Option<String>,
    /// `kid` for LTI JWKS (defaults to `lti-key-1`).
    pub lti_rsa_key_id: String,
    /// Inline submission annotation APIs + grader UI (plan 3.1). Default off for staged rollout.
    pub annotation_enabled: bool,
    /// Instructor audio/video feedback on submissions (plan 3.2). Default off.
    pub feedback_media_enabled: bool,
    /// Plan 3.3 — blind grading redaction on submission APIs. Default on; set `BLIND_GRADING_ENABLED=0` to disable.
    pub blind_grading_enabled: bool,
    /// Plan 3.4 — moderated grading APIs + gradebook gating. Default off; set `MODERATED_GRADING_ENABLED=1` to enable.
    pub moderated_grading_enabled: bool,
    /// Plan 3.5 — originality detection jobs + APIs. Default off; set `ORIGINALITY_DETECTION_ENABLED=1`.
    pub originality_detection_enabled: bool,
    /// Plan 3.5 — completes external similarity with stub data for local testing (`ORIGINALITY_STUB_EXTERNAL=1`).
    pub originality_stub_external: bool,
    /// Plan 3.8 — hold/post grade routes and student visibility. Default on; `GRADE_POSTING_POLICIES_ENABLED=0` disables.
    pub grade_posting_policies_enabled: bool,
    /// Plan 3.11 — bulk gradebook CSV. Default off; set `GRADEBOOK_CSV_ENABLED=1` to enable.
    pub gradebook_csv_enabled: bool,
}

const DEFAULT_CANVAS_ALLOWED_HOST_SUFFIXES: &[&str] = &["instructure.com"];

fn allow_insecure_jwt_from_env() -> bool {
    match env::var("ALLOW_INSECURE_JWT") {
        Ok(v) => matches!(
            v.trim().to_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn resolve_jwt_secret() -> anyhow::Result<String> {
    let allow_insecure = allow_insecure_jwt_from_env();
    match env::var("JWT_SECRET") {
        Ok(raw) => {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                if allow_insecure {
                    tracing::warn!(
                        "JWT_SECRET is empty; using insecure default because ALLOW_INSECURE_JWT is set (never use in production)"
                    );
                    return Ok(INSECURE_JWT_FALLBACK.to_string());
                }
                anyhow::bail!(
                    "JWT_SECRET is set but empty after trimming. Set JWT_SECRET to a random string of at least {JWT_SECRET_MIN_LEN} characters, or for local-only use set ALLOW_INSECURE_JWT=1."
                );
            }
            if trimmed.len() < JWT_SECRET_MIN_LEN {
                anyhow::bail!(
                    "JWT_SECRET must be at least {JWT_SECRET_MIN_LEN} characters (got {}). Generate one with e.g. `openssl rand -base64 48`.",
                    trimmed.len()
                );
            }
            Ok(trimmed)
        }
        Err(_) => {
            if allow_insecure {
                tracing::warn!(
                    "JWT_SECRET is not set; using insecure default because ALLOW_INSECURE_JWT is set (never use in production)"
                );
                Ok(INSECURE_JWT_FALLBACK.to_string())
            } else {
                anyhow::bail!(
                    "JWT_SECRET is not set. Set it to a random string of at least {JWT_SECRET_MIN_LEN} characters (e.g. `openssl rand -base64 48`). For local-only convenience you may set ALLOW_INSECURE_JWT=1 to use a development default — never enable that in production."
                )
            }
        }
    }
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is not set"))?;

        let jwt_secret = resolve_jwt_secret()?;

        // Empty string must not disable migrations (common in .env files as `RUN_MIGRATIONS=`).
        // Only explicit opt-out values turn migrations off.
        let run_migrations = match env::var("RUN_MIGRATIONS") {
            Err(_) => true,
            Ok(v) if v.trim().is_empty() => true,
            Ok(v) => !matches!(
                v.trim().to_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            ),
        };

        let open_router_api_key = env::var("OPENROUTER_API_KEY")
            .ok()
            .or_else(|| env::var("OPEN_ROUTER_API_KEY").ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let course_files_root = env::var("COURSE_FILES_ROOT")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("data/course-files"));

        let public_web_origin = env::var("PUBLIC_WEB_ORIGIN")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "http://localhost:5173".to_string());

        let smtp_host = env::var("SMTP_HOST")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let smtp_port = env::var("SMTP_PORT")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(587);
        let smtp_user = env::var("SMTP_USER")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let smtp_password = env::var("SMTP_PASSWORD")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let smtp_from = env::var("SMTP_FROM")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let canvas_allowed_host_suffixes = env::var("CANVAS_ALLOWED_HOST_SUFFIXES")
            .ok()
            .map(|raw| {
                raw.split(',')
                    .map(|s| {
                        s.trim()
                            .trim_start_matches("*.")
                            .trim_start_matches('.')
                            .to_ascii_lowercase()
                    })
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                DEFAULT_CANVAS_ALLOWED_HOST_SUFFIXES
                    .iter()
                    .map(|s| (*s).to_string())
                    .collect()
            });

        let lti_enabled = matches!(
            env::var("LTI_ENABLED")
                .ok()
                .map(|s| s.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1") | Some("true") | Some("yes") | Some("on")
        );

        let lti_api_base_url = env::var("LTI_API_BASE_URL")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "http://localhost:8080".to_string());

        let lti_rsa_private_key_pem = env::var("LTI_RSA_PRIVATE_KEY_PEM")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let lti_rsa_key_id = env::var("LTI_RSA_KEY_ID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "lti-key-1".to_string());

        let annotation_enabled = matches!(
            env::var("ANNOTATION_ENABLED")
                .ok()
                .map(|s| s.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1") | Some("true") | Some("yes") | Some("on")
        );

        let feedback_media_enabled = matches!(
            env::var("FEEDBACK_MEDIA_ENABLED")
                .ok()
                .map(|s| s.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1") | Some("true") | Some("yes") | Some("on")
        );

        let blind_grading_enabled = match env::var("BLIND_GRADING_ENABLED") {
            Err(_) => true,
            Ok(v) => {
                let t = v.trim().to_ascii_lowercase();
                t.is_empty()
                    || matches!(
                        t.as_str(),
                        "1" | "true" | "yes" | "on"
                    )
            }
        };

        let moderated_grading_enabled = matches!(
            env::var("MODERATED_GRADING_ENABLED")
                .ok()
                .map(|s| s.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1") | Some("true") | Some("yes") | Some("on")
        );

        let originality_detection_enabled = matches!(
            env::var("ORIGINALITY_DETECTION_ENABLED")
                .ok()
                .map(|s| s.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1") | Some("true") | Some("yes") | Some("on")
        );

        let originality_stub_external = matches!(
            env::var("ORIGINALITY_STUB_EXTERNAL")
                .ok()
                .map(|s| s.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1") | Some("true") | Some("yes") | Some("on")
        );

        let grade_posting_policies_enabled = match env::var("GRADE_POSTING_POLICIES_ENABLED") {
            Err(_) => true,
            Ok(v) => {
                let t = v.trim().to_ascii_lowercase();
                t.is_empty()
                    || matches!(
                        t.as_str(),
                        "1" | "true" | "yes" | "on"
                    )
            }
        };

        let gradebook_csv_enabled = matches!(
            env::var("GRADEBOOK_CSV_ENABLED")
                .ok()
                .map(|s| s.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1") | Some("true") | Some("yes") | Some("on")
        );

        Ok(Self {
            database_url,
            jwt_secret,
            run_migrations,
            open_router_api_key,
            course_files_root,
            canvas_allowed_host_suffixes,
            public_web_origin,
            smtp_host,
            smtp_port,
            smtp_user,
            smtp_password,
            smtp_from,
            lti_enabled,
            lti_api_base_url,
            lti_rsa_private_key_pem,
            lti_rsa_key_id,
            annotation_enabled,
            feedback_media_enabled,
            blind_grading_enabled,
            moderated_grading_enabled,
            originality_detection_enabled,
            originality_stub_external,
            grade_posting_policies_enabled,
            gradebook_csv_enabled,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    /// Exactly `JWT_SECRET_MIN_LEN` characters — use for any test that loads `Config::from_env()`.
    const VALID_TEST_JWT: &str = "01234567890123456789012345678901";

    fn set(key: &str, val: Option<&str>) {
        match val {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    fn base_env_for_config_ok() {
        set("DATABASE_URL", Some("postgres://localhost/x"));
        set("JWT_SECRET", Some(VALID_TEST_JWT));
        set("ALLOW_INSECURE_JWT", None);
    }

    #[test]
    #[serial]
    fn requires_database_url() {
        set("DATABASE_URL", None);
        set("JWT_SECRET", Some(VALID_TEST_JWT));
        assert!(Config::from_env().is_err());
    }

    #[test]
    #[serial]
    fn requires_jwt_secret_or_allow_insecure() {
        set("DATABASE_URL", Some("postgres://localhost/x"));
        set("JWT_SECRET", None);
        set("ALLOW_INSECURE_JWT", None);
        let err = Config::from_env().unwrap_err();
        assert!(
            err.to_string().contains("JWT_SECRET"),
            "unexpected err: {err}"
        );
    }

    #[test]
    #[serial]
    fn rejects_jwt_secret_shorter_than_minimum() {
        base_env_for_config_ok();
        set("JWT_SECRET", Some("0123456789012345678901234567890")); // 31 chars
        let err = Config::from_env().unwrap_err();
        assert!(
            err.to_string().contains("at least"),
            "unexpected err: {err}"
        );
    }

    #[test]
    #[serial]
    fn allow_insecure_jwt_uses_default_when_secret_unset() {
        set("DATABASE_URL", Some("postgres://localhost/x"));
        set("JWT_SECRET", None);
        set("ALLOW_INSECURE_JWT", Some("1"));
        let c = Config::from_env().unwrap();
        assert_eq!(c.jwt_secret, INSECURE_JWT_FALLBACK);
    }

    #[test]
    #[serial]
    fn run_migrations_defaults_true_when_unset() {
        base_env_for_config_ok();
        set("RUN_MIGRATIONS", None);
        let c = Config::from_env().unwrap();
        assert!(c.run_migrations);
    }

    #[test]
    #[serial]
    fn run_migrations_false_when_off() {
        base_env_for_config_ok();
        set("RUN_MIGRATIONS", Some("off"));
        let c = Config::from_env().unwrap();
        assert!(!c.run_migrations);
    }

    #[test]
    #[serial]
    fn empty_run_migrations_enables_migrations() {
        base_env_for_config_ok();
        set("RUN_MIGRATIONS", Some(""));
        let c = Config::from_env().unwrap();
        assert!(c.run_migrations);
    }

    #[test]
    #[serial]
    fn open_router_key_from_either_env_name() {
        base_env_for_config_ok();
        set("OPENROUTER_API_KEY", None);
        set("OPEN_ROUTER_API_KEY", Some(" k "));
        let c = Config::from_env().unwrap();
        assert_eq!(c.open_router_api_key.as_deref(), Some("k"));
    }

    #[test]
    #[serial]
    fn course_files_root_defaults_when_unset() {
        base_env_for_config_ok();
        set("COURSE_FILES_ROOT", None);
        let c = Config::from_env().unwrap();
        assert_eq!(
            c.course_files_root,
            std::path::PathBuf::from("data/course-files")
        );
    }

    #[test]
    #[serial]
    fn course_files_root_from_env() {
        base_env_for_config_ok();
        set("COURSE_FILES_ROOT", Some(" /tmp/cf "));
        let c = Config::from_env().unwrap();
        assert_eq!(c.course_files_root, std::path::PathBuf::from("/tmp/cf"));
    }

    #[test]
    #[serial]
    fn canvas_allowed_host_suffixes_default() {
        base_env_for_config_ok();
        set("CANVAS_ALLOWED_HOST_SUFFIXES", None);
        let c = Config::from_env().unwrap();
        assert_eq!(c.canvas_allowed_host_suffixes, vec!["instructure.com"]);
    }

    #[test]
    #[serial]
    fn canvas_allowed_host_suffixes_from_env_csv() {
        base_env_for_config_ok();
        set(
            "CANVAS_ALLOWED_HOST_SUFFIXES",
            Some(" *.instructure.com,canvas.mycollege.edu , "),
        );
        let c = Config::from_env().unwrap();
        assert_eq!(
            c.canvas_allowed_host_suffixes,
            vec!["instructure.com", "canvas.mycollege.edu"]
        );
    }
}
