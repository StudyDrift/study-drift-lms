use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub mod schema;

pub async fn connect(url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new().max_connections(10).connect(url).await
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    let mut migrator = sqlx::migrate!("./migrations");
    // If `_sqlx_migrations` lists a version not embedded in this binary (e.g. rolled back deploy or
    // stray row), sqlx errors with VersionMissing. Opt-in escape hatch for recovery; prefer fixing
    // the table or redeploying an image that includes the migration files.
    if matches!(
        std::env::var("SQLX_MIGRATIONS_IGNORE_MISSING").as_deref(),
        Ok("1" | "true" | "TRUE")
    ) {
        migrator.set_ignore_missing(true);
    }
    migrator.run(pool).await
}
