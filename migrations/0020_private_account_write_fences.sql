-- Commit-time fences for private domain writes. Lifecycle jobs, retained runtime
-- registries and outbox cleanup remain operator/system-owned exceptions.
-- Missing parents are handled by foreign keys; OLD and NEW ownership are checked.

CREATE TRIGGER capabilities_active_account_insert BEFORE INSERT ON capabilities
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER capabilities_active_account_update BEFORE UPDATE ON capabilities
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER capabilities_active_account_delete BEFORE DELETE ON capabilities
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER class_sessions_active_account_insert BEFORE INSERT ON class_sessions
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER class_sessions_active_account_update BEFORE UPDATE ON class_sessions
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER class_sessions_active_account_delete BEFORE DELETE ON class_sessions
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER courses_active_account_insert BEFORE INSERT ON courses
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER courses_active_account_update BEFORE UPDATE ON courses
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER courses_active_account_delete BEFORE DELETE ON courses
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER events_active_account_insert BEFORE INSERT ON events
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER events_active_account_update BEFORE UPDATE ON events
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER events_active_account_delete BEFORE DELETE ON events
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER notes_active_account_insert BEFORE INSERT ON notes
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER notes_active_account_update BEFORE UPDATE ON notes
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER notes_active_account_delete BEFORE DELETE ON notes
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER notifications_active_account_insert BEFORE INSERT ON notifications
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER notifications_active_account_update BEFORE UPDATE ON notifications
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER notifications_active_account_delete BEFORE DELETE ON notifications
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER resources_active_account_insert BEFORE INSERT ON resources
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER resources_active_account_update BEFORE UPDATE ON resources
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER resources_active_account_delete BEFORE DELETE ON resources
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER rituals_active_account_insert BEFORE INSERT ON rituals
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER rituals_active_account_update BEFORE UPDATE ON rituals
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER rituals_active_account_delete BEFORE DELETE ON rituals
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_sessions_active_account_insert BEFORE INSERT ON study_sessions
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_sessions_active_account_update BEFORE UPDATE ON study_sessions
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_sessions_active_account_delete BEFORE DELETE ON study_sessions
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tasks_active_account_insert BEFORE INSERT ON tasks
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tasks_active_account_update BEFORE UPDATE ON tasks
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tasks_active_account_delete BEFORE DELETE ON tasks
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tutor_conversations_active_account_insert BEFORE INSERT ON tutor_conversations
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tutor_conversations_active_account_update BEFORE UPDATE ON tutor_conversations
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tutor_conversations_active_account_delete BEFORE DELETE ON tutor_conversations
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER user_misconceptions_active_account_insert BEFORE INSERT ON user_misconceptions
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER user_misconceptions_active_account_update BEFORE UPDATE ON user_misconceptions
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER user_misconceptions_active_account_delete BEFORE DELETE ON user_misconceptions
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER user_corrections_active_account_insert BEFORE INSERT ON user_corrections
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER user_corrections_active_account_update BEFORE UPDATE ON user_corrections
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER user_corrections_active_account_delete BEFORE DELETE ON user_corrections
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER runtime_tutor_session_events_active_account_insert BEFORE INSERT ON runtime_tutor_session_events
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER runtime_tutor_session_events_active_account_update BEFORE UPDATE ON runtime_tutor_session_events
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER runtime_tutor_session_events_active_account_delete BEFORE DELETE ON runtime_tutor_session_events
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER academic_terms_active_account_insert BEFORE INSERT ON academic_terms
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER academic_terms_active_account_update BEFORE UPDATE ON academic_terms
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER academic_terms_active_account_delete BEFORE DELETE ON academic_terms
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER onboarding_imports_active_account_insert BEFORE INSERT ON onboarding_imports
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER onboarding_imports_active_account_update BEFORE UPDATE ON onboarding_imports
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER onboarding_imports_active_account_delete BEFORE DELETE ON onboarding_imports
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_connections_active_account_insert BEFORE INSERT ON calendar_connections
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_connections_active_account_update BEFORE UPDATE ON calendar_connections
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_connections_active_account_delete BEFORE DELETE ON calendar_connections
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_external_events_active_account_insert BEFORE INSERT ON calendar_external_events
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_external_events_active_account_update BEFORE UPDATE ON calendar_external_events
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_external_events_active_account_delete BEFORE DELETE ON calendar_external_events
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_event_links_active_account_insert BEFORE INSERT ON calendar_event_links
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_event_links_active_account_update BEFORE UPDATE ON calendar_event_links
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_event_links_active_account_delete BEFORE DELETE ON calendar_event_links
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER event_idempotency_keys_active_account_insert BEFORE INSERT ON event_idempotency_keys
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER event_idempotency_keys_active_account_update BEFORE UPDATE ON event_idempotency_keys
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER event_idempotency_keys_active_account_delete BEFORE DELETE ON event_idempotency_keys
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_session_timing_active_account_insert BEFORE INSERT ON study_session_timing
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_session_timing_active_account_update BEFORE UPDATE ON study_session_timing
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active') OR EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_session_timing_active_account_delete BEFORE DELETE ON study_session_timing
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER assessments_active_account_insert BEFORE INSERT ON assessments
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = NEW.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER assessments_active_account_update BEFORE UPDATE ON assessments
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = OLD.course_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = NEW.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER assessments_active_account_delete BEFORE DELETE ON assessments
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = OLD.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER branches_active_account_insert BEFORE INSERT ON branches
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = NEW.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER branches_active_account_update BEFORE UPDATE ON branches
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = OLD.course_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = NEW.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER branches_active_account_delete BEFORE DELETE ON branches
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = OLD.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER kcs_active_account_insert BEFORE INSERT ON kcs
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = NEW.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER kcs_active_account_update BEFORE UPDATE ON kcs
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = OLD.course_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = NEW.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER kcs_active_account_delete BEFORE DELETE ON kcs
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = OLD.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER course_template_decisions_active_account_insert BEFORE INSERT ON course_template_decisions
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = NEW.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER course_template_decisions_active_account_update BEFORE UPDATE ON course_template_decisions
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = OLD.course_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = NEW.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER course_template_decisions_active_account_delete BEFORE DELETE ON course_template_decisions
WHEN EXISTS (SELECT 1 FROM courses JOIN users ON users.id = courses.user_id WHERE courses.id = OLD.course_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER exercises_active_account_insert BEFORE INSERT ON exercises
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = NEW.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER exercises_active_account_update BEFORE UPDATE ON exercises
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = OLD.kc_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = NEW.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER exercises_active_account_delete BEFORE DELETE ON exercises
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = OLD.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER kc_edges_active_account_insert BEFORE INSERT ON kc_edges
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = NEW.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER kc_edges_active_account_update BEFORE UPDATE ON kc_edges
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = OLD.kc_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = NEW.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER kc_edges_active_account_delete BEFORE DELETE ON kc_edges
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = OLD.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER misconceptions_active_account_insert BEFORE INSERT ON misconceptions
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = NEW.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER misconceptions_active_account_update BEFORE UPDATE ON misconceptions
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = OLD.kc_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = NEW.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER misconceptions_active_account_delete BEFORE DELETE ON misconceptions
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = OLD.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER scaffolds_active_account_insert BEFORE INSERT ON scaffolds
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = NEW.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER scaffolds_active_account_update BEFORE UPDATE ON scaffolds
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = OLD.kc_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = NEW.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER scaffolds_active_account_delete BEFORE DELETE ON scaffolds
WHEN EXISTS (SELECT 1 FROM kcs JOIN courses ON courses.id = kcs.course_id JOIN users ON users.id = courses.user_id WHERE kcs.id = OLD.kc_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER assessment_kcs_active_account_insert BEFORE INSERT ON assessment_kcs
WHEN EXISTS (SELECT 1 FROM assessments JOIN courses ON courses.id = assessments.course_id JOIN users ON users.id = courses.user_id WHERE assessments.id = NEW.assessment_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER assessment_kcs_active_account_update BEFORE UPDATE ON assessment_kcs
WHEN EXISTS (SELECT 1 FROM assessments JOIN courses ON courses.id = assessments.course_id JOIN users ON users.id = courses.user_id WHERE assessments.id = OLD.assessment_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM assessments JOIN courses ON courses.id = assessments.course_id JOIN users ON users.id = courses.user_id WHERE assessments.id = NEW.assessment_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER assessment_kcs_active_account_delete BEFORE DELETE ON assessment_kcs
WHEN EXISTS (SELECT 1 FROM assessments JOIN courses ON courses.id = assessments.course_id JOIN users ON users.id = courses.user_id WHERE assessments.id = OLD.assessment_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER capability_kcs_active_account_insert BEFORE INSERT ON capability_kcs
WHEN EXISTS (SELECT 1 FROM capabilities JOIN users ON users.id = capabilities.user_id WHERE capabilities.id = NEW.capability_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER capability_kcs_active_account_update BEFORE UPDATE ON capability_kcs
WHEN EXISTS (SELECT 1 FROM capabilities JOIN users ON users.id = capabilities.user_id WHERE capabilities.id = OLD.capability_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM capabilities JOIN users ON users.id = capabilities.user_id WHERE capabilities.id = NEW.capability_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER capability_kcs_active_account_delete BEFORE DELETE ON capability_kcs
WHEN EXISTS (SELECT 1 FROM capabilities JOIN users ON users.id = capabilities.user_id WHERE capabilities.id = OLD.capability_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER note_links_active_account_insert BEFORE INSERT ON note_links
WHEN EXISTS (SELECT 1 FROM notes JOIN users ON users.id = notes.user_id WHERE notes.id = NEW.note_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER note_links_active_account_update BEFORE UPDATE ON note_links
WHEN EXISTS (SELECT 1 FROM notes JOIN users ON users.id = notes.user_id WHERE notes.id = OLD.note_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM notes JOIN users ON users.id = notes.user_id WHERE notes.id = NEW.note_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER note_links_active_account_delete BEFORE DELETE ON note_links
WHEN EXISTS (SELECT 1 FROM notes JOIN users ON users.id = notes.user_id WHERE notes.id = OLD.note_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER task_courses_active_account_insert BEFORE INSERT ON task_courses
WHEN EXISTS (SELECT 1 FROM tasks JOIN users ON users.id = tasks.user_id WHERE tasks.id = NEW.task_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER task_courses_active_account_update BEFORE UPDATE ON task_courses
WHEN EXISTS (SELECT 1 FROM tasks JOIN users ON users.id = tasks.user_id WHERE tasks.id = OLD.task_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM tasks JOIN users ON users.id = tasks.user_id WHERE tasks.id = NEW.task_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER task_courses_active_account_delete BEFORE DELETE ON task_courses
WHEN EXISTS (SELECT 1 FROM tasks JOIN users ON users.id = tasks.user_id WHERE tasks.id = OLD.task_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER session_kcs_active_account_insert BEFORE INSERT ON session_kcs
WHEN EXISTS (SELECT 1 FROM study_sessions JOIN users ON users.id = study_sessions.user_id WHERE study_sessions.id = NEW.study_session_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER session_kcs_active_account_update BEFORE UPDATE ON session_kcs
WHEN EXISTS (SELECT 1 FROM study_sessions JOIN users ON users.id = study_sessions.user_id WHERE study_sessions.id = OLD.study_session_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM study_sessions JOIN users ON users.id = study_sessions.user_id WHERE study_sessions.id = NEW.study_session_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER session_kcs_active_account_delete BEFORE DELETE ON session_kcs
WHEN EXISTS (SELECT 1 FROM study_sessions JOIN users ON users.id = study_sessions.user_id WHERE study_sessions.id = OLD.study_session_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_session_finalizations_active_account_insert BEFORE INSERT ON study_session_finalizations
WHEN EXISTS (SELECT 1 FROM study_sessions JOIN users ON users.id = study_sessions.user_id WHERE study_sessions.id = NEW.study_session_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_session_finalizations_active_account_update BEFORE UPDATE ON study_session_finalizations
WHEN EXISTS (SELECT 1 FROM study_sessions JOIN users ON users.id = study_sessions.user_id WHERE study_sessions.id = OLD.study_session_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM study_sessions JOIN users ON users.id = study_sessions.user_id WHERE study_sessions.id = NEW.study_session_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER study_session_finalizations_active_account_delete BEFORE DELETE ON study_session_finalizations
WHEN EXISTS (SELECT 1 FROM study_sessions JOIN users ON users.id = study_sessions.user_id WHERE study_sessions.id = OLD.study_session_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tutor_messages_active_account_insert BEFORE INSERT ON tutor_messages
WHEN EXISTS (SELECT 1 FROM tutor_conversations JOIN users ON users.id = tutor_conversations.user_id WHERE tutor_conversations.id = NEW.conversation_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tutor_messages_active_account_update BEFORE UPDATE ON tutor_messages
WHEN EXISTS (SELECT 1 FROM tutor_conversations JOIN users ON users.id = tutor_conversations.user_id WHERE tutor_conversations.id = OLD.conversation_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM tutor_conversations JOIN users ON users.id = tutor_conversations.user_id WHERE tutor_conversations.id = NEW.conversation_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER tutor_messages_active_account_delete BEFORE DELETE ON tutor_messages
WHEN EXISTS (SELECT 1 FROM tutor_conversations JOIN users ON users.id = tutor_conversations.user_id WHERE tutor_conversations.id = OLD.conversation_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_provider_calendars_active_account_insert BEFORE INSERT ON calendar_provider_calendars
WHEN EXISTS (SELECT 1 FROM calendar_connections JOIN users ON users.id = calendar_connections.user_id WHERE calendar_connections.id = NEW.connection_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_provider_calendars_active_account_update BEFORE UPDATE ON calendar_provider_calendars
WHEN EXISTS (SELECT 1 FROM calendar_connections JOIN users ON users.id = calendar_connections.user_id WHERE calendar_connections.id = OLD.connection_id AND users.account_state <> 'active') OR EXISTS (SELECT 1 FROM calendar_connections JOIN users ON users.id = calendar_connections.user_id WHERE calendar_connections.id = NEW.connection_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_provider_calendars_active_account_delete BEFORE DELETE ON calendar_provider_calendars
WHEN EXISTS (SELECT 1 FROM calendar_connections JOIN users ON users.id = calendar_connections.user_id WHERE calendar_connections.id = OLD.connection_id AND users.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_sync_states_active_account_insert BEFORE INSERT ON calendar_sync_states
WHEN EXISTS (SELECT 1 FROM calendar_provider_calendars p JOIN calendar_connections c ON c.id=p.connection_id JOIN users u ON u.id=c.user_id WHERE p.id=NEW.provider_calendar_id AND u.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_sync_states_active_account_update BEFORE UPDATE ON calendar_sync_states
WHEN EXISTS (SELECT 1 FROM calendar_provider_calendars p JOIN calendar_connections c ON c.id=p.connection_id JOIN users u ON u.id=c.user_id WHERE p.id=OLD.provider_calendar_id AND u.account_state <> 'active') OR EXISTS (SELECT 1 FROM calendar_provider_calendars p JOIN calendar_connections c ON c.id=p.connection_id JOIN users u ON u.id=c.user_id WHERE p.id=NEW.provider_calendar_id AND u.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_sync_states_active_account_delete BEFORE DELETE ON calendar_sync_states
WHEN EXISTS (SELECT 1 FROM calendar_provider_calendars p JOIN calendar_connections c ON c.id=p.connection_id JOIN users u ON u.id=c.user_id WHERE p.id=OLD.provider_calendar_id AND u.account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER attachments_active_account_insert BEFORE INSERT ON attachments
WHEN (NEW.state <> 'pending' AND EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active'))
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER attachments_active_account_update BEFORE UPDATE ON attachments
WHEN (OLD.state <> 'pending' AND EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND account_state <> 'active')) OR (NEW.state <> 'pending' AND EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active'))
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER attachments_active_account_delete BEFORE DELETE ON attachments
WHEN (OLD.state <> 'pending' AND EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND account_state <> 'active'))
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_feed_active_account_insert BEFORE INSERT ON calendar_feed_credentials
WHEN NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;

CREATE TRIGGER calendar_feed_active_account_update BEFORE UPDATE ON calendar_feed_credentials
WHEN NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND account_state <> 'active')
BEGIN SELECT RAISE(ABORT, 'inactive account'); END;
