ALTER TABLE `tenants` ADD `mailbox_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `outbound_suspended_at` datetime;