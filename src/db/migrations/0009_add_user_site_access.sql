CREATE TABLE `user_sites` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`site_id` char(26) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_sites_user_site_idx` UNIQUE(`user_id`,`site_id`)
);
--> statement-breakpoint
ALTER TABLE `deals` ADD `site_id` char(26);--> statement-breakpoint
CREATE INDEX `user_sites_tenant_id_idx` ON `user_sites` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `user_sites_user_id_idx` ON `user_sites` (`user_id`);--> statement-breakpoint
CREATE INDEX `deals_tenant_site_idx` ON `deals` (`tenant_id`,`site_id`);