ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER NOT NULL DEFAULT 25 CHECK (estimated_minutes BETWEEN 5 AND 480);
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 2);
ALTER TABLE study_sessions ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE study_sessions ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE study_sessions ADD COLUMN managed INTEGER NOT NULL DEFAULT 0;
CREATE TABLE planning_preferences (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id), enabled INTEGER NOT NULL DEFAULT 0,
 weekly_minutes INTEGER NOT NULL DEFAULT 420 CHECK (weekly_minutes BETWEEN 0 AND 10080),
 availability TEXT NOT NULL DEFAULT '[]',
 revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT planning_revision_nonnegative CHECK (revision >= 0),
 applying INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE planning_jobs (user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id), available_at INTEGER NOT NULL, requested_at INTEGER NOT NULL);
CREATE TABLE planning_runs (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','applied','undone')),
 source_revision INTEGER NOT NULL, applied_revision INTEGER,
 changes TEXT NOT NULL, unplaced TEXT NOT NULL, created_at INTEGER NOT NULL, applied_at INTEGER
);
CREATE INDEX planning_runs_user_created_idx ON planning_runs(user_id,created_at);

-- Source changes invalidate previews and coalesce opt-in automatic replanning.
CREATE TRIGGER planning_dirty_tasks_insert AFTER INSERT ON tasks
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_tasks_update AFTER UPDATE ON tasks
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_tasks_delete AFTER DELETE ON tasks
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_study_sessions_insert AFTER INSERT ON study_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_study_sessions_update AFTER UPDATE ON study_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_study_sessions_delete AFTER DELETE ON study_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_class_sessions_insert AFTER INSERT ON class_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_class_sessions_update AFTER UPDATE ON class_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_class_sessions_delete AFTER DELETE ON class_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_calendar_external_events_insert AFTER INSERT ON calendar_external_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_calendar_external_events_update AFTER UPDATE ON calendar_external_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_calendar_external_events_delete AFTER DELETE ON calendar_external_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_events_insert AFTER INSERT ON events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_events_update AFTER UPDATE ON events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_events_delete AFTER DELETE ON events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_study_session_timing_insert AFTER INSERT ON study_session_timing
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_study_session_timing_update AFTER UPDATE ON study_session_timing
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_study_session_timing_delete AFTER DELETE ON study_session_timing
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_assessments_insert AFTER INSERT ON assessments
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM courses WHERE id=NEW.course_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM courses WHERE id=NEW.course_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_assessments_update AFTER UPDATE ON assessments
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM courses WHERE id=OLD.course_id UNION SELECT user_id FROM courses WHERE id=NEW.course_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM courses WHERE id=OLD.course_id UNION SELECT user_id FROM courses WHERE id=NEW.course_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_assessments_delete AFTER DELETE ON assessments
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM courses WHERE id=OLD.course_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM courses WHERE id=OLD.course_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_preferences_active_insert BEFORE INSERT ON planning_preferences WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
CREATE TRIGGER planning_preferences_active_update BEFORE UPDATE ON planning_preferences WHEN EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
CREATE TRIGGER planning_preferences_active_delete BEFORE DELETE ON planning_preferences WHEN EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
CREATE TRIGGER planning_runs_active_insert BEFORE INSERT ON planning_runs WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
CREATE TRIGGER planning_runs_active_update BEFORE UPDATE ON planning_runs WHEN EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
CREATE TRIGGER planning_runs_active_delete BEFORE DELETE ON planning_runs WHEN EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
CREATE TRIGGER planning_jobs_active_insert BEFORE INSERT ON planning_jobs WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
CREATE TRIGGER planning_jobs_active_update BEFORE UPDATE ON planning_jobs WHEN EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
CREATE TRIGGER planning_jobs_active_delete BEFORE DELETE ON planning_jobs WHEN EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND account_state <> 'active') BEGIN SELECT RAISE(ABORT,'inactive account'); END;
