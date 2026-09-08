-- Accepted group sessions invalidate only each attendee's private plan.
CREATE TRIGGER planning_dirty_group_event_rsvps_insert AFTER INSERT ON group_event_rsvps
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_group_event_rsvps_update AFTER UPDATE ON group_event_rsvps
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_group_event_rsvps_delete AFTER DELETE ON group_event_rsvps
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_group_events_insert AFTER INSERT ON group_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=NEW.id AND response='going') AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=NEW.id AND response='going') AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_group_events_update AFTER UPDATE ON group_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=OLD.id AND response='going' UNION SELECT user_id FROM group_event_rsvps WHERE event_id=NEW.id AND response='going') AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=OLD.id AND response='going' UNION SELECT user_id FROM group_event_rsvps WHERE event_id=NEW.id AND response='going') AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_group_events_delete AFTER DELETE ON group_events
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=OLD.id AND response='going') AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM group_event_rsvps WHERE event_id=OLD.id AND response='going') AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_group_members_insert AFTER INSERT ON group_members
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_group_members_update AFTER UPDATE ON group_members
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id UNION SELECT NEW.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
CREATE TRIGGER planning_dirty_group_members_delete AFTER DELETE ON group_members
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT OLD.user_id) AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT OLD.user_id) AND enabled=1 AND applying=0 AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at;
END;
