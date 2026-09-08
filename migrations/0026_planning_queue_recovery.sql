ALTER TABLE planning_jobs ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planning_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
-- Removing a background request is cleanup; it never removes retained domain data.
DROP TRIGGER planning_jobs_active_delete;
CREATE TRIGGER planning_account_deletion AFTER UPDATE OF account_state ON users WHEN NEW.account_state <> 'active'
BEGIN DELETE FROM planning_jobs WHERE user_id=NEW.id; END;

DROP TRIGGER planning_dirty_tasks_insert;
CREATE TRIGGER planning_dirty_tasks_insert AFTER INSERT ON tasks
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_tasks_update;
CREATE TRIGGER planning_dirty_tasks_update AFTER UPDATE ON tasks
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_tasks_delete;
CREATE TRIGGER planning_dirty_tasks_delete AFTER DELETE ON tasks
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_study_sessions_insert;
CREATE TRIGGER planning_dirty_study_sessions_insert AFTER INSERT ON study_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_study_sessions_update;
CREATE TRIGGER planning_dirty_study_sessions_update AFTER UPDATE ON study_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_study_sessions_delete;
CREATE TRIGGER planning_dirty_study_sessions_delete AFTER DELETE ON study_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_class_sessions_insert;
CREATE TRIGGER planning_dirty_class_sessions_insert AFTER INSERT ON class_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_class_sessions_update;
CREATE TRIGGER planning_dirty_class_sessions_update AFTER UPDATE ON class_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_class_sessions_delete;
CREATE TRIGGER planning_dirty_class_sessions_delete AFTER DELETE ON class_sessions
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_calendar_external_events_insert;
CREATE TRIGGER planning_dirty_calendar_external_events_insert AFTER INSERT ON calendar_external_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_calendar_external_events_update;
CREATE TRIGGER planning_dirty_calendar_external_events_update AFTER UPDATE ON calendar_external_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_calendar_external_events_delete;
CREATE TRIGGER planning_dirty_calendar_external_events_delete AFTER DELETE ON calendar_external_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_events_insert;
CREATE TRIGGER planning_dirty_events_insert AFTER INSERT ON events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_events_update;
CREATE TRIGGER planning_dirty_events_update AFTER UPDATE ON events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_events_delete;
CREATE TRIGGER planning_dirty_events_delete AFTER DELETE ON events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_study_session_timing_insert;
CREATE TRIGGER planning_dirty_study_session_timing_insert AFTER INSERT ON study_session_timing
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_study_session_timing_update;
CREATE TRIGGER planning_dirty_study_session_timing_update AFTER UPDATE ON study_session_timing
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_study_session_timing_delete;
CREATE TRIGGER planning_dirty_study_session_timing_delete AFTER DELETE ON study_session_timing
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_assessments_insert;
CREATE TRIGGER planning_dirty_assessments_insert AFTER INSERT ON assessments
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM courses WHERE id=NEW.course_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM courses WHERE id=NEW.course_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_assessments_update;
CREATE TRIGGER planning_dirty_assessments_update AFTER UPDATE ON assessments
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM courses WHERE id=OLD.course_id UNION SELECT user_id FROM courses WHERE id=NEW.course_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM courses WHERE id=OLD.course_id UNION SELECT user_id FROM courses WHERE id=NEW.course_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_assessments_delete;
CREATE TRIGGER planning_dirty_assessments_delete AFTER DELETE ON assessments
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM courses WHERE id=OLD.course_id) AND applying=0;
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM courses WHERE id=OLD.course_id) AND enabled=1 AND applying=0
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_event_rsvps_insert;
CREATE TRIGGER planning_dirty_group_event_rsvps_insert AFTER INSERT ON group_event_rsvps
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_event_rsvps_update;
CREATE TRIGGER planning_dirty_group_event_rsvps_update AFTER UPDATE ON group_event_rsvps
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_event_rsvps_delete;
CREATE TRIGGER planning_dirty_group_event_rsvps_delete AFTER DELETE ON group_event_rsvps
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_events_insert;
CREATE TRIGGER planning_dirty_group_events_insert AFTER INSERT ON group_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=NEW.id AND response='going') AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=NEW.id AND response='going') AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_events_update;
CREATE TRIGGER planning_dirty_group_events_update AFTER UPDATE ON group_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=OLD.id AND response='going' UNION SELECT user_id FROM group_event_rsvps WHERE event_id=NEW.id AND response='going') AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=OLD.id AND response='going' UNION SELECT user_id FROM group_event_rsvps WHERE event_id=NEW.id AND response='going') AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_events_delete;
CREATE TRIGGER planning_dirty_group_events_delete AFTER DELETE ON group_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=OLD.id AND response='going') AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=OLD.id AND response='going') AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_members_insert;
CREATE TRIGGER planning_dirty_group_members_insert AFTER INSERT ON group_members
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_members_update;
CREATE TRIGGER planning_dirty_group_members_update AFTER UPDATE ON group_members
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

DROP TRIGGER planning_dirty_group_members_delete;
CREATE TRIGGER planning_dirty_group_members_delete AFTER DELETE ON group_members
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

CREATE TRIGGER planning_dirty_users_timezone AFTER UPDATE OF timezone ON users WHEN NEW.timezone <> OLD.timezone
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

CREATE TRIGGER planning_dirty_calendar_selection AFTER UPDATE OF selected ON calendar_provider_calendars WHEN NEW.selected <> OLD.selected
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM calendar_connections WHERE id=NEW.connection_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM calendar_connections WHERE id=NEW.connection_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

CREATE TRIGGER planning_dirty_calendar_connection_delete BEFORE DELETE ON calendar_connections
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

CREATE TRIGGER planning_dirty_calendar_connection_update AFTER UPDATE OF status ON calendar_connections WHEN NEW.status <> OLD.status
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

CREATE TRIGGER planning_dirty_calendar_provider_insert AFTER INSERT ON calendar_provider_calendars
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM calendar_connections WHERE id=NEW.connection_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM calendar_connections WHERE id=NEW.connection_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

CREATE TRIGGER planning_dirty_calendar_provider_delete BEFORE DELETE ON calendar_provider_calendars
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM calendar_connections WHERE id=OLD.connection_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM calendar_connections WHERE id=OLD.connection_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;
