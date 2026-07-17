CREATE TABLE `account` (
	`id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`provider_id` varchar(255) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` datetime,
	`refresh_token_expires_at` datetime,
	`scope` text,
	`password` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `account_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires_at` datetime NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` char(26),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `session_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`tenant_id` char(26),
	`tenant_role` varchar(10),
	`role` varchar(20) DEFAULT 'user',
	`banned` boolean DEFAULT false,
	`ban_reason` text,
	`ban_expires` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` char(26) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `verification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` varchar(10) NOT NULL DEFAULT 'agent',
	`token` varchar(64) NOT NULL,
	`invited_by_user_id` char(26),
	`expires_at` datetime NOT NULL,
	`accepted_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_token_unique` UNIQUE(`token`),
	CONSTRAINT `invitations_tenant_email_uq` UNIQUE(`tenant_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'trial',
	`locale` varchar(10) NOT NULL DEFAULT 'es',
	`timezone` varchar(64) NOT NULL DEFAULT 'America/Asuncion',
	`settings` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` char(26) NOT NULL,
	`subscription_id` char(26) NOT NULL,
	`amount` bigint NOT NULL,
	`currency` char(3) NOT NULL DEFAULT 'PYG',
	`method` varchar(20) NOT NULL,
	`reference` varchar(255),
	`recorded_by_user_id` char(26) NOT NULL,
	`notes` varchar(1000),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` char(26) NOT NULL,
	`name` varchar(100) NOT NULL,
	`duration_months` bigint NOT NULL,
	`price` bigint NOT NULL,
	`currency` char(3) NOT NULL DEFAULT 'PYG',
	`limits` json,
	`features` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`plan_id` char(26) NOT NULL,
	`starts_at` datetime NOT NULL,
	`expires_at` datetime NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26),
	`actor_user_id` char(26),
	`impersonator_user_id` char(26),
	`action` varchar(100) NOT NULL,
	`entity` varchar(100),
	`entity_id` char(26),
	`payload` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_subscription_id_subscriptions_id_fk` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_tenant_id_idx` ON `user` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `invitations_tenant_id_idx` ON `invitations` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `payments_subscription_id_idx` ON `payments` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_tenant_id_idx` ON `subscriptions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `audit_log_tenant_id_idx` ON `audit_log` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_user_id`);