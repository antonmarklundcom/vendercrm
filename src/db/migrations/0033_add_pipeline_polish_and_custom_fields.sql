CREATE TABLE `custom_field_definitions` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`key` varchar(64) NOT NULL,
	`label` varchar(200) NOT NULL,
	`type` varchar(10) NOT NULL,
	`options` json NOT NULL DEFAULT ('[]'),
	`position` int NOT NULL DEFAULT 0,
	`required` boolean NOT NULL DEFAULT false,
	`show_on_card` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `custom_field_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `custom_field_definitions_tenant_key_idx` UNIQUE(`tenant_id`,`key`)
);
--> statement-breakpoint
ALTER TABLE `deals` ADD `lost_reason` varchar(500);--> statement-breakpoint
ALTER TABLE `deals` ADD `expected_close_at` datetime;--> statement-breakpoint
ALTER TABLE `stages` ADD `stale_after_days` int;--> statement-breakpoint
CREATE INDEX `custom_field_definitions_tenant_id_idx` ON `custom_field_definitions` (`tenant_id`);