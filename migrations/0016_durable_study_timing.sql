-- No backfilled elapsed time: legacy wall-clock age is not verified study time.
CREATE TABLE study_session_timing (
 session_id TEXT PRIMARY KEY NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'paused' CHECK(state IN ('paused','running','ended')),
 elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_ms >= 0),
 device_id TEXT,
 lease_token TEXT,
 last_ack_at INTEGER,
 lease_expires_at INTEGER,
 sequence INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX study_timing_one_running_user ON study_session_timing(user_id) WHERE state = 'running';
