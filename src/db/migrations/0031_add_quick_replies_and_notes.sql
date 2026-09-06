CREATE TABLE `conversation_notes` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`conversation_id` char(26) NOT NULL,
	`contact_id` char(26) NOT NULL,
	`author_user_id` char(26) NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `conversation_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quick_replies` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`name` varchar(100) NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `quick_replies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `conversation_notes_tenant_id_idx` ON `conversation_notes` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `conversation_notes_conversation_id_idx` ON `conversation_notes` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `conversation_notes_contact_id_idx` ON `conversation_notes` (`contact_id`);--> statement-breakpoint
CREATE INDEX `quick_replies_tenant_id_idx` ON `quick_replies` (`tenant_id`);