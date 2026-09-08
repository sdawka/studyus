-- Task course links are planning inputs. Relation-only edits invalidate an
-- issued preview and refresh the learner's coalesced automatic planning job.
CREATE TRIGGER planning_dirty_task_courses_insert AFTER INSERT ON task_courses
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM tasks WHERE id=NEW.task_id) AND applying=0
   AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM tasks WHERE id=NEW.task_id) AND enabled=1 AND applying=0
   AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

CREATE TRIGGER planning_dirty_task_courses_update AFTER UPDATE ON task_courses
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM tasks WHERE id=OLD.task_id UNION SELECT user_id FROM tasks WHERE id=NEW.task_id) AND applying=0
   AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM tasks WHERE id=OLD.task_id UNION SELECT user_id FROM tasks WHERE id=NEW.task_id) AND enabled=1 AND applying=0
   AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;

CREATE TRIGGER planning_dirty_task_courses_delete AFTER DELETE ON task_courses
BEGIN
 UPDATE planning_preferences SET revision=revision+1,updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE user_id IN (SELECT user_id FROM tasks WHERE id=OLD.task_id) AND applying=0
   AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active');
 INSERT INTO planning_jobs(user_id,available_at,requested_at)
 SELECT user_id,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM planning_preferences WHERE user_id IN (SELECT user_id FROM tasks WHERE id=OLD.task_id) AND enabled=1 AND applying=0
   AND EXISTS(SELECT 1 FROM users WHERE users.id=planning_preferences.user_id AND account_state='active')
 ON CONFLICT(user_id) DO UPDATE SET available_at=excluded.available_at,requested_at=excluded.requested_at,version=planning_jobs.version+1,attempt_count=0;
END;
