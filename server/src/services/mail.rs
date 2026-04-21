use lettre::message::Message;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};

use crate::state::MailSettings;

pub async fn send_password_reset_email(
    settings: &MailSettings,
    to_email: &str,
    reset_url: &str,
) -> Result<(), String> {
    let host = match settings.smtp_host.as_deref().filter(|s| !s.is_empty()) {
        None => {
            tracing::info!(
                to = %to_email,
                reset_url = %reset_url,
                "password reset (SMTP not configured; set SMTP_HOST to send email)"
            );
            return Ok(());
        }
        Some(h) => h,
    };

    let from_str = settings
        .smtp_from
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "SMTP_FROM is required when SMTP_HOST is set".to_string())?;

    let body = format!(
        "You requested a password reset for your StudyDrift account.\n\n\
Open this link to choose a new password (it expires in one hour):\n\n\
{reset_url}\n\n\
If you did not request this, you can ignore this message.\n"
    );

    let email = Message::builder()
        .from(
            from_str
                .parse()
                .map_err(|e| format!("invalid SMTP_FROM: {e}"))?,
        )
        .to(to_email
            .parse()
            .map_err(|e| format!("invalid recipient address: {e}"))?)
        .subject("Reset your StudyDrift password")
        .body(body)
        .map_err(|e| e.to_string())?;

    let creds = match (
        settings.smtp_user.as_deref(),
        settings.smtp_password.as_deref(),
    ) {
        (Some(u), Some(p)) if !u.is_empty() => Some(Credentials::new(u.to_string(), p.to_string())),
        _ => None,
    };

    let mut relay = AsyncSmtpTransport::<Tokio1Executor>::relay(host)
        .map_err(|e| e.to_string())?
        .port(settings.smtp_port);
    if let Some(c) = creds {
        relay = relay.credentials(c);
    }
    let mailer = relay.build();

    mailer.send(email).await.map_err(|e| e.to_string())?;
    Ok(())
}
