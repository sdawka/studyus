CREATE TABLE calendar_provision_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_account_id TEXT NOT NULL,
  marker TEXT NOT NULL,
  remote_calendar_id TEXT,
  connection_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'remote_created', 'persisted', 'cleanup_failed')),
  lease_token TEXT,
  lease_expires_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX calendar_provision_account_unique ON calendar_provision_ledger(user_id, provider, external_account_id);
CREATE INDEX calendar_provision_state_updated_idx ON calendar_provision_ledger(state, updated_at);
CREATE UNIQUE INDEX calendar_provision_marker_unique ON calendar_provision_ledger(marker);
CREATE INDEX calendar_provision_state_lease_idx ON calendar_provision_ledger(state, lease_expires_at);
