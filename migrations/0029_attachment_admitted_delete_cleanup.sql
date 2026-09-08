-- A ready -> deleting transition is admitted only while the owner is active.
-- Provider/system cleanup may then remove that already-admitted record after
-- account deletion; retained ready attachment rows remain protected.
DROP TRIGGER attachments_active_account_delete;
CREATE TRIGGER attachments_active_account_delete BEFORE DELETE ON attachments
WHEN OLD.state = 'ready' AND EXISTS (
  SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active'
)
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;
