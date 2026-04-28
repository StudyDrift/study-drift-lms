-- Rename course:*:module:create -> course:*:item:create (grants + catalog).
-- Do not change 013 after it has been applied (sqlx checksum); use migrations like this one instead.
UPDATE course.user_course_grants
SET permission_string = regexp_replace(permission_string, ':module:create$', ':item:create')
WHERE permission_string LIKE '%:module:create';

UPDATE "user".permissions
SET permission_string = regexp_replace(permission_string, ':module:create$', ':item:create')
WHERE permission_string LIKE '%:module:create';
