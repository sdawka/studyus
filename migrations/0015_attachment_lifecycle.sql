ALTER TABLE attachments ADD COLUMN state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('pending','ready','deleting'));
ALTER TABLE attachments ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE attachments SET updated_at = created_at;
CREATE INDEX attachments_user_state_idx ON attachments(user_id,state);
CREATE INDEX attachments_reconcile_idx ON attachments(state,updated_at);
