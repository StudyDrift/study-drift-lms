-- `ON DELETE SET NULL` was incompatible with `user_audit_structure_item_kind`: deleting a
-- structure item would null out `structure_item_id` on content_open/content_leave rows and
-- violate the check. Cascade removes those audit rows when the item is removed.
ALTER TABLE "user".user_audit
    DROP CONSTRAINT IF EXISTS user_audit_structure_item_id_fkey;

ALTER TABLE "user".user_audit
    ADD CONSTRAINT user_audit_structure_item_id_fkey
        FOREIGN KEY (structure_item_id)
        REFERENCES course.course_structure_items (id)
        ON DELETE CASCADE;
