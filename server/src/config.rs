use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub run_migrations: bool,
    /// OpenRouter API key for AI features (image generation, etc.). Empty disables AI calls.
    pub open_router_api_key: Option<String>,
    /// Root directory for per-course uploaded files (images, etc.). Override with `COURSE_FILES_ROOT`.
    pub course_files_root: PathBuf,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is not set"))?;

        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| {
            tracing::warn!("JWT_SECRET is not set; using an insecure development default");
            "dev-secret-do-not-use-in-production".to_string()
        });

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

        Ok(Self {
            database_url,
            jwt_secret,
            run_migrations,
            open_router_api_key,
            course_files_root,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    fn set(key: &str, val: Option<&str>) {
        match val {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    #[serial]
    fn requires_database_url() {
        set("DATABASE_URL", None);
        assert!(Config::from_env().is_err());
    }

    #[test]
    #[serial]
    fn run_migrations_defaults_true_when_unset() {
        set("DATABASE_URL", Some("postgres://localhost/x"));
        set("RUN_MIGRATIONS", None);
        let c = Config::from_env().unwrap();
        assert!(c.run_migrations);
    }

    #[test]
    #[serial]
    fn run_migrations_false_when_off() {
        set("DATABASE_URL", Some("postgres://localhost/x"));
        set("RUN_MIGRATIONS", Some("off"));
        let c = Config::from_env().unwrap();
        assert!(!c.run_migrations);
    }

    #[test]
    #[serial]
    fn empty_run_migrations_enables_migrations() {
        set("DATABASE_URL", Some("postgres://localhost/x"));
        set("RUN_MIGRATIONS", Some(""));
        let c = Config::from_env().unwrap();
        assert!(c.run_migrations);
    }

    #[test]
    #[serial]
    fn open_router_key_from_either_env_name() {
        set("DATABASE_URL", Some("postgres://localhost/x"));
        set("OPENROUTER_API_KEY", None);
        set("OPEN_ROUTER_API_KEY", Some(" k "));
        let c = Config::from_env().unwrap();
        assert_eq!(c.open_router_api_key.as_deref(), Some("k"));
    }

    #[test]
    #[serial]
    fn course_files_root_defaults_when_unset() {
        set("DATABASE_URL", Some("postgres://localhost/x"));
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
        set("DATABASE_URL", Some("postgres://localhost/x"));
        set("COURSE_FILES_ROOT", Some(" /tmp/cf "));
        let c = Config::from_env().unwrap();
        assert_eq!(c.course_files_root, std::path::PathBuf::from("/tmp/cf"));
    }
}
