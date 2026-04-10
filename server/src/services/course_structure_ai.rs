//! AI-assisted edits to course module structure via OpenRouter tool calls.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_structure::CourseStructureItemResponse;
use crate::repos::course_structure;
use crate::repos::system_prompts;
use crate::services::ai::{OpenRouterClient, OpenRouterError, ToolCall};

const MAX_AI_STEPS: usize = 24;

const COURSE_STRUCTURE_PROMPT_KEY: &str = "course_structure";

/// Fallback if `settings.system_prompts` has no row (migration not applied).
const FALLBACK_COURSE_STRUCTURE_SYSTEM_PROMPT: &str = r#"You are an assistant that edits LMS course module structure. You MUST call the provided tools to make changes; do not claim changes were applied without calling tools.

Rules:
- Use only UUIDs from the CURRENT STRUCTURE JSON in the user message for module_id and reorder operations.
- After creating a module, heading, or content page, the tool response includes the new id — use it in later steps if needed.
- For reorder_structure, module_order must list every module id exactly once, in the desired top-to-bottom order. child_order_by_module maps each module id to the ordered list of child item ids under that module (headings and content pages). Include every module id as a key; use [] for modules with no children.
- Keep spoken replies brief after you are done calling tools."#;

fn map_open_router_err(e: OpenRouterError) -> AppError {
    match e {
        OpenRouterError::NoImageInResponse => {
            AppError::AiGenerationFailed("The model returned an unexpected response.".into())
        }
        OpenRouterError::ApiStatus(code, msg) => AppError::AiGenerationFailed(format!(
            "OpenRouter ({code}): {}",
            msg.chars().take(800).collect::<String>()
        )),
        OpenRouterError::Http(err) => AppError::AiGenerationFailed(err.to_string()),
        OpenRouterError::Json(err) => AppError::AiGenerationFailed(err.to_string()),
    }
}

fn ai_tools() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "create_module",
                "description": "Create a new top-level module with the given name.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Module title" }
                    },
                    "required": ["name"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_heading",
                "description": "Create a heading under an existing module.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Heading title" },
                        "module_id": { "type": "string", "description": "Parent module UUID" }
                    },
                    "required": ["name", "module_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_content_page",
                "description": "Create a content page under an existing module.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Page title" },
                        "module_id": { "type": "string", "description": "Parent module UUID" }
                    },
                    "required": ["name", "module_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "reorder_structure",
                "description": "Reorder top-level modules and the items inside each module.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "module_order": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Ordered list of module UUIDs (all modules, top to bottom)"
                        },
                        "child_order_by_module": {
                            "type": "object",
                            "additionalProperties": {
                                "type": "array",
                                "items": { "type": "string" }
                            },
                            "description": "Maps each module UUID to ordered child item UUIDs; use [] for modules with no children"
                        }
                    },
                    "required": ["module_order", "child_order_by_module"]
                }
            }
        }),
    ]
}

#[derive(Deserialize)]
struct NameArg {
    name: String,
}

#[derive(Deserialize)]
struct ModuleChildArgs {
    name: String,
    #[serde(alias = "moduleId")]
    module_id: Uuid,
}

#[derive(Deserialize)]
struct ReorderArgs {
    #[serde(alias = "moduleOrder")]
    module_order: Vec<Uuid>,
    #[serde(default, alias = "childOrderByModule")]
    child_order_by_module: HashMap<Uuid, Vec<Uuid>>,
}

fn assistant_message_json(content: Option<String>, tool_calls: &[ToolCall]) -> Value {
    let tool_calls_json: Vec<Value> = tool_calls
        .iter()
        .map(|tc| {
            json!({
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.name,
                    "arguments": tc.arguments
                }
            })
        })
        .collect();
    json!({
        "role": "assistant",
        "content": content,
        "tool_calls": tool_calls_json
    })
}

async fn execute_tool(pool: &sqlx::PgPool, course_id: Uuid, name: &str, arguments: &str) -> String {
    match name {
        "create_module" => {
            let Ok(args) = serde_json::from_str::<NameArg>(arguments) else {
                return json!({ "ok": false, "error": "Invalid JSON for create_module" })
                    .to_string();
            };
            let title = args.name.trim();
            if title.is_empty() {
                return json!({ "ok": false, "error": "name is required" }).to_string();
            }
            match course_structure::insert_module(pool, course_id, title).await {
                Ok(row) => {
                    let r: CourseStructureItemResponse = row.into();
                    json!({ "ok": true, "item": r })
                }
                Err(e) => json!({ "ok": false, "error": e.to_string() }),
            }
            .to_string()
        }
        "create_heading" => {
            let Ok(args) = serde_json::from_str::<ModuleChildArgs>(arguments) else {
                return json!({ "ok": false, "error": "Invalid JSON for create_heading" })
                    .to_string();
            };
            let title = args.name.trim();
            if title.is_empty() {
                return json!({ "ok": false, "error": "name is required" }).to_string();
            }
            match course_structure::insert_heading_under_module(
                pool,
                course_id,
                args.module_id,
                title,
            )
            .await
            {
                Ok(row) => {
                    let r: CourseStructureItemResponse = row.into();
                    json!({ "ok": true, "item": r })
                }
                Err(e) => {
                    if matches!(&e, sqlx::Error::RowNotFound) {
                        json!({ "ok": false, "error": "module not found or not in this course" })
                    } else {
                        json!({ "ok": false, "error": e.to_string() })
                    }
                }
            }
            .to_string()
        }
        "create_content_page" => {
            let Ok(args) = serde_json::from_str::<ModuleChildArgs>(arguments) else {
                return json!({ "ok": false, "error": "Invalid JSON for create_content_page" })
                    .to_string();
            };
            let title = args.name.trim();
            if title.is_empty() {
                return json!({ "ok": false, "error": "name is required" }).to_string();
            }
            match course_structure::insert_content_page_under_module(
                pool,
                course_id,
                args.module_id,
                title,
            )
            .await
            {
                Ok(row) => {
                    let r: CourseStructureItemResponse = row.into();
                    json!({ "ok": true, "item": r })
                }
                Err(e) => {
                    if matches!(&e, sqlx::Error::RowNotFound) {
                        json!({ "ok": false, "error": "module not found or not in this course" })
                    } else {
                        json!({ "ok": false, "error": e.to_string() })
                    }
                }
            }
            .to_string()
        }
        "reorder_structure" => {
            let Ok(args) = serde_json::from_str::<ReorderArgs>(arguments) else {
                return json!({ "ok": false, "error": "Invalid JSON for reorder_structure" })
                    .to_string();
            };
            match course_structure::apply_module_and_child_order(
                pool,
                course_id,
                &args.module_order,
                &args.child_order_by_module,
            )
            .await
            {
                Ok(()) => json!({ "ok": true }).to_string(),
                Err(e) => {
                    if matches!(&e, sqlx::Error::RowNotFound) {
                        json!({ "ok": false, "error": "invalid order: ids must match current structure exactly" })
                            .to_string()
                    } else {
                        json!({ "ok": false, "error": e.to_string() }).to_string()
                    }
                }
            }
        }
        _ => json!({ "ok": false, "error": format!("unknown tool {name}") }).to_string(),
    }
}

/// Runs a tool-calling loop against OpenRouter until the model stops requesting tools.
pub async fn run_course_structure_ai(
    pool: &sqlx::PgPool,
    client: &OpenRouterClient,
    model: &str,
    course_id: Uuid,
    user_request: &str,
) -> Result<(Vec<CourseStructureItemResponse>, Option<String>), AppError> {
    let system_prompt = match system_prompts::get_content_by_key(pool, COURSE_STRUCTURE_PROMPT_KEY).await
    {
        Ok(Some(s)) if !s.trim().is_empty() => s,
        Ok(_) => FALLBACK_COURSE_STRUCTURE_SYSTEM_PROMPT.to_string(),
        Err(e) => {
            tracing::error!(error = %e, "failed to load system prompt row");
            FALLBACK_COURSE_STRUCTURE_SYSTEM_PROMPT.to_string()
        }
    };

    let tools = ai_tools();
    let mut tail: Vec<Value> = Vec::new();

    for _ in 0..MAX_AI_STEPS {
        let rows = course_structure::list_for_course(pool, course_id).await?;
        let items: Vec<CourseStructureItemResponse> = rows.into_iter().map(Into::into).collect();
        let structure_json = serde_json::to_string_pretty(&items)
            .map_err(|e| AppError::AiGenerationFailed(e.to_string()))?;

        let user_body = format!(
            "CURRENT STRUCTURE (JSON):\n```json\n{structure_json}\n```\n\nInstructor request:\n{}",
            user_request.trim()
        );

        let mut messages = vec![
            json!({ "role": "system", "content": system_prompt }),
            json!({ "role": "user", "content": user_body }),
        ];
        messages.extend(tail.clone());

        let assistant = client
            .chat_completion(model, &messages, &tools)
            .await
            .map_err(map_open_router_err)?;

        if assistant.tool_calls.is_empty() {
            let rows = course_structure::list_for_course(pool, course_id).await?;
            let items: Vec<CourseStructureItemResponse> =
                rows.into_iter().map(Into::into).collect();
            return Ok((items, assistant.content));
        }

        tail.push(assistant_message_json(
            assistant.content,
            &assistant.tool_calls,
        ));

        for tc in &assistant.tool_calls {
            let out = execute_tool(pool, course_id, &tc.name, &tc.arguments).await;
            tail.push(json!({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": out
            }));
        }
    }

    Err(AppError::AiGenerationFailed(
        "The assistant took too many steps. Try a smaller request.".into(),
    ))
}

#[cfg(test)]
mod err_tests {
    use super::map_open_router_err;
    use crate::error::AppError;
    use crate::services::ai::OpenRouterError;

    #[test]
    fn maps_open_router_errors() {
        let e = map_open_router_err(OpenRouterError::NoImageInResponse);
        assert!(matches!(e, AppError::AiGenerationFailed(_)));
        let e2 = map_open_router_err(OpenRouterError::ApiStatus(400, "{}".into()));
        assert!(matches!(e2, AppError::AiGenerationFailed(_)));
    }
}
