ALTER TABLE `users` ADD `timezone` text DEFAULT 'UTC' NOT NULL;
--> statement-breakpoint
CREATE TABLE `calendar_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_account_id` text NOT NULL,
	`sync_mode` text DEFAULT 'controlled' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_connections_user_provider_account_unique` ON `calendar_connections` (`user_id`,`provider`,`external_account_id`);
--> statement-breakpoint
CREATE INDEX `calendar_connections_user_status_idx` ON `calendar_connections` (`user_id`,`status`);
--> statement-breakpoint
CREATE TABLE `calendar_provider_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`provider_calendar_id` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text,
	`selected` integer DEFAULT false NOT NULL,
	`studyus_owned` integer DEFAULT false NOT NULL,
	`access_role` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_provider_calendars_connection_remote_unique` ON `calendar_provider_calendars` (`connection_id`,`provider_calendar_id`);
--> statement-breakpoint
CREATE INDEX `calendar_provider_calendars_connection_selected_idx` ON `calendar_provider_calendars` (`connection_id`,`selected`);
--> statement-breakpoint
CREATE TABLE `calendar_sync_states` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_calendar_id` text NOT NULL,
	`cursor` text,
	`webhook_channel_id` text,
	`webhook_resource_id` text,
	`webhook_expires_at` integer,
	`last_synced_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`provider_calendar_id`) REFERENCES `calendar_provider_calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_sync_states_calendar_unique` ON `calendar_sync_states` (`provider_calendar_id`);
--> statement-breakpoint
CREATE TABLE `calendar_external_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_calendar_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`provider_version` text,
	`ical_uid` text,
	`recurring_event_id` text,
	`title` text DEFAULT 'Busy' NOT NULL,
	`start_kind` text,
	`start_at` integer,
	`start_date` text,
	`end_at` integer,
	`end_date` text,
	`timezone` text,
	`busy_status` text DEFAULT 'busy' NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`recurrence` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_calendar_id`) REFERENCES `calendar_provider_calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_external_events_calendar_remote_unique` ON `calendar_external_events` (`provider_calendar_id`,`provider_event_id`);
--> statement-breakpoint
CREATE INDEX `calendar_external_events_user_start_idx` ON `calendar_external_events` (`user_id`,`start_at`);
--> statement-breakpoint
CREATE INDEX `calendar_external_events_user_start_date_idx` ON `calendar_external_events` (`user_id`,`start_date`);
--> statement-breakpoint
CREATE TABLE `calendar_event_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_calendar_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`local_entity_type` text NOT NULL,
	`local_entity_id` text NOT NULL,
	`provider_version` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_calendar_id`) REFERENCES `calendar_provider_calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_calendar_remote_unique` ON `calendar_event_links` (`provider_calendar_id`,`provider_event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_links_calendar_local_unique` ON `calendar_event_links` (`provider_calendar_id`,`local_entity_type`,`local_entity_id`);
--> statement-breakpoint
CREATE INDEX `calendar_event_links_user_local_idx` ON `calendar_event_links` (`user_id`,`local_entity_type`,`local_entity_id`);
--> statement-breakpoint
CREATE TABLE `calendar_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`revision` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_outbox_dedupe_key_unique` ON `calendar_outbox` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `calendar_outbox_status_available_idx` ON `calendar_outbox` (`status`,`available_at`);
--> statement-breakpoint
CREATE TABLE `calendar_feed_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`revoked_at` integer,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_credentials_user_unique` ON `calendar_feed_credentials` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_credentials_hash_unique` ON `calendar_feed_credentials` (`token_hash`);
