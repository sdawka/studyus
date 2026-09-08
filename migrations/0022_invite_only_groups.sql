CREATE TABLE groups(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,owner_user_id TEXT REFERENCES users(id),state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','read_only')),revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT groups_revision_nonnegative CHECK(revision>=0),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX groups_owner_state_idx ON groups(owner_user_id,state);
CREATE TABLE group_members(group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),joined_at INTEGER NOT NULL,PRIMARY KEY(group_id,user_id));
CREATE UNIQUE INDEX group_members_one_owner ON group_members(group_id) WHERE role='owner';
CREATE INDEX group_members_user_idx ON group_members(user_id);
CREATE TABLE group_invitations(id TEXT PRIMARY KEY NOT NULL,group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,email_hash TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,invited_by_user_id TEXT REFERENCES users(id),expires_at INTEGER NOT NULL,accepted_at INTEGER,accepted_by_user_id TEXT REFERENCES users(id),created_at INTEGER NOT NULL,CONSTRAINT group_invitation_acceptance_valid CHECK(accepted_at IS NULL OR accepted_at>=created_at));
CREATE INDEX group_invitations_group_expiry_idx ON group_invitations(group_id,expires_at);
CREATE TABLE group_resources(id TEXT PRIMARY KEY NOT NULL,group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,author_user_id TEXT REFERENCES users(id),author_label TEXT NOT NULL,author_deleted_at INTEGER,url TEXT NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX group_resources_group_created_idx ON group_resources(group_id,created_at);
CREATE TABLE group_files(id TEXT PRIMARY KEY NOT NULL,group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,author_user_id TEXT REFERENCES users(id),author_label TEXT NOT NULL,author_deleted_at INTEGER,r2_key TEXT NOT NULL UNIQUE,filename TEXT NOT NULL,content_type TEXT,size_bytes INTEGER NOT NULL CHECK(size_bytes>=0 AND size_bytes<=10485760),state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','deleting')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX group_files_group_state_idx ON group_files(group_id,state);
CREATE TABLE group_events(id TEXT PRIMARY KEY NOT NULL,group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,host_user_id TEXT REFERENCES users(id),host_label TEXT NOT NULL,host_deleted_at INTEGER,title TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,timezone TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','cancelled')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,CONSTRAINT group_events_positive_duration CHECK(ends_at>starts_at));
CREATE INDEX group_events_group_start_idx ON group_events(group_id,starts_at);
CREATE TABLE group_event_rsvps(event_id TEXT NOT NULL REFERENCES group_events(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),response TEXT NOT NULL CHECK(response IN ('going','maybe','declined')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(event_id,user_id));
CREATE INDEX group_rsvps_user_idx ON group_event_rsvps(user_id);
CREATE TABLE group_owner_reassignments(id TEXT PRIMARY KEY NOT NULL,group_id TEXT NOT NULL REFERENCES groups(id),previous_owner_user_id TEXT,new_owner_user_id TEXT NOT NULL,operator_label TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);

CREATE TRIGGER groups_owner_insert BEFORE INSERT ON groups WHEN NEW.owner_user_id IS NOT NULL AND (
 NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.owner_user_id AND account_state='active') OR
 (SELECT COUNT(*) FROM groups WHERE owner_user_id=NEW.owner_user_id)>=5)
BEGIN SELECT RAISE(ABORT,'group owner limit or inactive owner'); END;
CREATE TRIGGER groups_owner_update BEFORE UPDATE OF owner_user_id ON groups WHEN NEW.owner_user_id IS NOT NULL AND (
 NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.owner_user_id AND account_state='active') OR
 (SELECT COUNT(*) FROM groups WHERE owner_user_id=NEW.owner_user_id AND id<>NEW.id)>=5)
BEGIN SELECT RAISE(ABORT,'group owner limit or inactive owner'); END;
CREATE TRIGGER group_members_admission BEFORE INSERT ON group_members WHEN
 NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND account_state='active') OR
 NOT EXISTS(SELECT 1 FROM groups WHERE id=NEW.group_id AND state='active' AND owner_user_id IS NOT NULL) OR
 (SELECT COUNT(*) FROM group_members WHERE group_id=NEW.group_id)>=25
BEGIN SELECT RAISE(ABORT,'group member limit or inactive group'); END;
