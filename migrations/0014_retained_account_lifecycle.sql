-- Retain account data and deterministic runtime references after Clerk deletion.
ALTER TABLE users ADD COLUMN account_state TEXT NOT NULL DEFAULT 'active' CHECK(account_state IN ('active','deleting','deleted'));
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
DROP INDEX users_email_unique;
CREATE UNIQUE INDEX users_active_email_unique ON users(email) WHERE account_state = 'active';
CREATE TABLE learner_runtime_registry (
 user_id TEXT PRIMARY KEY NOT NULL,
 object_name TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleting','deleted')),
 deletion_event_id TEXT,
 deleted_at INTEGER,
 updated_at INTEGER NOT NULL
);
INSERT INTO learner_runtime_registry(user_id,object_name,state,updated_at)
 SELECT id,'learner:' || id,'active',created_at FROM users;
CREATE TABLE account_deletion_events (
 event_id TEXT PRIMARY KEY NOT NULL,
 clerk_user_id TEXT NOT NULL,
 received_at INTEGER NOT NULL
);
CREATE INDEX account_deletion_events_clerk_idx ON account_deletion_events(clerk_user_id);
CREATE TABLE account_deletion_jobs (
 clerk_user_id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT,
 event_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done')),
 attempt_count INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX account_deletion_jobs_pending_idx ON account_deletion_jobs(state,available_at);
