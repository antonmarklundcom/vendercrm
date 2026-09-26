CREATE TABLE `email_attachments` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`email_message_id` char(26) NOT NULL,
	`storage_key` varchar(500) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`mime_type` varchar(150) NOT NULL,
	`size` int NOT NULL,
	`content_id` varchar(255),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `email_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_messages` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`thread_id` char(26) NOT NULL,
	`mailbox_id` char(26) NOT NULL,
	`direction` varchar(3) NOT NULL,
	`message_id` varchar(500) NOT NULL,
	`in_reply_to` varchar(500),
	`references` text,
	`from_address` varchar(320) NOT NULL,
	`from_name` varchar(200),
	`reply_to` varchar(320),
	`to` json NOT NULL DEFAULT ('[]'),
	`cc` json NOT NULL DEFAULT ('[]'),
	`subject` varchar(500) NOT NULL DEFAULT '',
	`text_body` mediumtext,
	`html_body` mediumtext,
	`raw_key` varchar(500),
	`status` varchar(10) NOT NULL,
	`sent_by_user_id` char(26),
	`sent_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `email_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_messages_tenant_message_id_idx` UNIQUE(`tenant_id`,`message_id`)
);
--> statement-breakpoint
CREATE TABLE `email_threads` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`mailbox_id` char(26) NOT NULL,
	`subject` varchar(500) NOT NULL DEFAULT '',
	`normalized_subject` varchar(500) NOT NULL DEFAULT '',
	`participant_email` varchar(320) NOT NULL,
	`participant_name` varchar(200),
	`contact_id` char(26),
	`deal_id` char(26),
	`status` varchar(10) NOT NULL DEFAULT 'open',
	`unread` boolean NOT NULL DEFAULT true,
	`last_message_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `email_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`address` varchar(320) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`display_name` varchar(200),
	`is_catch_all` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `mailboxes_id` PRIMARY KEY(`id`),
	CONSTRAINT `mailboxes_address_idx` UNIQUE(`address`)
);
--> statement-breakpoint
CREATE INDEX `email_attachments_tenant_message_idx` ON `email_attachments` (`tenant_id`,`email_message_id`);--> statement-breakpoint
CREATE INDEX `email_messages_tenant_thread_idx` ON `email_messages` (`tenant_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `email_messages_tenant_mailbox_dir_idx` ON `email_messages` (`tenant_id`,`mailbox_id`,`direction`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_threads_tenant_last_idx` ON `email_threads` (`tenant_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `email_threads_tenant_mailbox_idx` ON `email_threads` (`tenant_id`,`mailbox_id`);--> statement-breakpoint
CREATE INDEX `email_threads_tenant_participant_idx` ON `email_threads` (`tenant_id`,`participant_email`);--> statement-breakpoint
CREATE INDEX `email_threads_tenant_contact_idx` ON `email_threads` (`tenant_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `mailboxes_tenant_id_idx` ON `mailboxes` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `mailboxes_domain_idx` ON `mailboxes` (`domain`);