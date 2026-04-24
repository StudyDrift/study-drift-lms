-- Isolate user- and course-domain tables into dedicated schemas.
-- Schema name "user" is quoted because USER is reserved in PostgreSQL.

CREATE SCHEMA "user";
CREATE SCHEMA course;

-- User/RBAC tables (order respects FKs among moved tables).
ALTER TABLE users SET SCHEMA "user";
ALTER TABLE permissions SET SCHEMA "user";
ALTER TABLE app_roles SET SCHEMA "user";
ALTER TABLE rbac_role_permissions SET SCHEMA "user";
ALTER TABLE user_app_roles SET SCHEMA "user";

-- Courses (FKs from public.communication / user_ai_settings to users update automatically).
ALTER TABLE courses SET SCHEMA course;
ALTER TABLE course_enrollments SET SCHEMA course;
