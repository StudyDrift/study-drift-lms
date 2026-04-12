//! Qualified PostgreSQL identifiers for tables moved out of `public`.
//! The `user` schema must be double-quoted in SQL (`USER` is reserved).

pub const USERS: &str = r#""user".users"#;
pub const PERMISSIONS: &str = r#""user".permissions"#;
pub const APP_ROLES: &str = r#""user".app_roles"#;
pub const RBAC_ROLE_PERMISSIONS: &str = r#""user".rbac_role_permissions"#;
pub const USER_APP_ROLES: &str = r#""user".user_app_roles"#;
pub const USER_AI_SETTINGS: &str = r#""user".user_ai_settings"#;
pub const USER_AUDIT: &str = r#""user".user_audit"#;
pub const COURSES: &str = "course.courses";
pub const COURSE_ENROLLMENTS: &str = "course.course_enrollments";
pub const COURSE_STRUCTURE_ITEMS: &str = "course.course_structure_items";
pub const MODULE_CONTENT_PAGES: &str = "course.module_content_pages";
pub const MODULE_ASSIGNMENTS: &str = "course.module_assignments";
pub const MODULE_QUIZZES: &str = "course.module_quizzes";
pub const MODULE_EXTERNAL_LINKS: &str = "course.module_external_links";
pub const COURSE_SYLLABUS: &str = "course.course_syllabus";
pub const SYLLABUS_ACCEPTANCES: &str = "course.syllabus_acceptances";
pub const USER_COURSE_GRANTS: &str = "course.user_course_grants";
pub const USER_COURSE_CATALOG_ORDER: &str = "course.user_course_catalog_order";
pub const ASSIGNMENT_GROUPS: &str = "course.assignment_groups";
pub const SETTINGS_SYSTEM_PROMPTS: &str = "settings.system_prompts";
pub const SETTINGS_SYSTEM_PROMPTS_AUDIT: &str = "settings.system_prompts_audit";
pub const COURSE_FILES: &str = "course.course_files";
pub const FEED_CHANNELS: &str = "course.feed_channels";
pub const FEED_MESSAGES: &str = "course.feed_messages";
pub const FEED_MESSAGE_LIKES: &str = "course.feed_message_likes";
pub const FEED_MESSAGE_MENTIONS: &str = "course.feed_message_mentions";
