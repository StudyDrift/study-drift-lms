//! StudyDrift API server binary.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    study_drift_server::run().await
}
