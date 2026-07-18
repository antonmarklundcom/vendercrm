CREATE TABLE `conversations` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`wa_account_id` char(26) NOT NULL,
	`contact_id` char(26) NOT NULL,
	`assigned_user_id` char(26),
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`last_message_at` datetime,
	`last_inbound_at` datetime,
	`unread_count` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversations_account_contact_uq` UNIQUE(`wa_account_id`,`contact_id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`conversation_id` char(26) NOT NULL,
	`direction` varchar(4) NOT NULL,
	`wa_message_id` varchar(128),
	`type` varchar(24) NOT NULL DEFAULT 'text',
	`body` text,
	`media_id` varchar(128),
	`storage_key` varchar(255),
	`status` varchar(16) NOT NULL,
	`error` json,
	`sent_by_user_id` char(26),
	`automation_run_id` char(26),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `messages_wa_message_id_uq` UNIQUE(`wa_message_id`)
);
--> statement-breakpoint
CREATE TABLE `wa_accounts` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`waba_id` varchar(64) NOT NULL,
	`phone_number_id` varchar(64) NOT NULL,
	`display_number` varchar(32),
	`verified_name` varchar(255),
	`status` varchar(32) NOT NULL DEFAULT 'connected',
	`quality_rating` varchar(16),
	`access_token_ciphertext` text,
	`access_token_iv` varchar(32),
	`access_token_tag` varchar(32),
	`connected_via` varchar(16) NOT NULL DEFAULT 'manual',
	`webhook_subscribed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `wa_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `wa_accounts_phone_number_id_uq` UNIQUE(`phone_number_id`)
);
--> statement-breakpoint
CREATE TABLE `wa_templates` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`wa_account_id` char(26) NOT NULL,
	`name` varchar(128) NOT NULL,
	`language` varchar(16) NOT NULL,
	`category` varchar(32),
	`status` varchar(32) NOT NULL,
	`components` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `wa_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `wa_templates_account_name_lang_uq` UNIQUE(`wa_account_id`,`name`,`language`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` char(26) NOT NULL,
	`phone_number_id` varchar(64),
	`payload` json NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'received',
	`error` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_wa_account_id_wa_accounts_id_fk` FOREIGN KEY (`wa_account_id`) REFERENCES `wa_accounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_accounts` ADD CONSTRAINT `wa_accounts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_templates` ADD CONSTRAINT `wa_templates_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wa_templates` ADD CONSTRAINT `wa_templates_wa_account_id_wa_accounts_id_fk` FOREIGN KEY (`wa_account_id`) REFERENCES `wa_accounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `conversations_tenant_idx` ON `conversations` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `messages_tenant_idx` ON `messages` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `wa_accounts_tenant_idx` ON `wa_accounts` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `wa_templates_tenant_idx` ON `wa_templates` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `webhook_events_phone_idx` ON `webhook_events` (`phone_number_id`);--> statement-breakpoint
CREATE INDEX `webhook_events_status_idx` ON `webhook_events` (`status`);