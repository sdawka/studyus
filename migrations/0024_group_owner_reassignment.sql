CREATE TRIGGER group_owner_reassignment_admission BEFORE INSERT ON group_owner_reassignments
WHEN NOT EXISTS(SELECT 1 FROM groups WHERE id=NEW.group_id AND state='read_only' AND owner_user_id IS NULL)
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.new_owner_user_id AND account_state='active')
 OR NOT EXISTS(SELECT 1 FROM group_members WHERE group_id=NEW.group_id AND user_id=NEW.new_owner_user_id)
 OR (SELECT COUNT(*) FROM groups WHERE owner_user_id=NEW.new_owner_user_id)>=5
BEGIN SELECT RAISE(ABORT,'invalid group owner reassignment'); END;
CREATE TRIGGER group_owner_reassignment_apply AFTER INSERT ON group_owner_reassignments
BEGIN
 UPDATE group_members SET role='owner' WHERE group_id=NEW.group_id AND user_id=NEW.new_owner_user_id;
 UPDATE groups SET owner_user_id=NEW.new_owner_user_id,state='active',revision=revision+1,updated_at=NEW.created_at WHERE id=NEW.group_id;
END;
