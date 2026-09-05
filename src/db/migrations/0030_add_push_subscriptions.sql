CREATE TABLE `push_subscriptions` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`endpoint` varchar(500) NOT NULL,
	`p256dh` varchar(255) NOT NULL,
	`auth` varchar(255) NOT NULL,
	`user_agent` varchar(255),
	`last_seen_at` datetime,
	`failed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscriptions_endpoint_idx` UNIQUE(`endpoint`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `push_prefs` json;--> statement-breakpoint
CREATE INDEX `push_subscriptions_tenant_user_idx` ON `push_subscriptions` (`tenant_id`,`user_id`);