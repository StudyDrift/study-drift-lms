//! AI integrations (OpenRouter and future providers).
//!
//! Keep provider-specific HTTP and parsing in [`open_router`]. Route handlers should call
//! these services and map errors to [`crate::error::AppError`].

pub mod open_router;

pub use open_router::{
    list_image_models, list_text_models, OpenRouterClient, OpenRouterError, ToolCall,
};
