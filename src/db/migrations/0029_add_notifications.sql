CREATE TABLE `notifications` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`kind` varchar(40) NOT NULL DEFAULT 'system',
	`title` varchar(200) NOT NULL,
	`body` text,
	`url` varchar(500),
	`read_at` datetime,
	`flow_run_id` char(26),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `notifications_tenant_user_read_idx` ON `notifications` (`tenant_id`,`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notifications_tenant_user_created_idx` ON `notifications` (`tenant_id`,`user_id`,`created_at`);