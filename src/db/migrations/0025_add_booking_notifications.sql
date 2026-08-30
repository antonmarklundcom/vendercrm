CREATE TABLE `gcal_connections` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`google_account_email` varchar(320),
	`calendar_id` varchar(320) NOT NULL DEFAULT 'primary',
	`access_token_ciphertext` text NOT NULL,
	`access_token_iv` varchar(64) NOT NULL,
	`access_token_tag` varchar(64) NOT NULL,
	`access_token_expires_at` datetime,
	`refresh_token_ciphertext` text,
	`refresh_token_iv` varchar(64),
	`refresh_token_tag` varchar(64),
	`status` varchar(12) NOT NULL DEFAULT 'connected',
	`last_error` varchar(500),
	`last_busy_read_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `gcal_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `gcal_connections_tenant_user_idx` UNIQUE(`tenant_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `booking_notifications` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`booking_id` char(26) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`channel` varchar(12) NOT NULL,
	`status` varchar(10) NOT NULL DEFAULT 'queued',
	`template_name` varchar(200),
	`message_id` char(26),
	`detail` varchar(500),
	`sent_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `booking_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `booking_type_services` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`booking_type_id` char(26) NOT NULL,
	`name` varchar(200) NOT NULL,
	`extra_duration_minutes` int NOT NULL DEFAULT 0,
	`extra_price` bigint,
	`sort` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `booking_type_services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bookings` MODIFY COLUMN `status` varchar(16) NOT NULL DEFAULT 'confirmed';--> statement-breakpoint
ALTER TABLE `booking_types` ADD `capacity` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_types` ADD `deposit_amount` bigint;--> statement-breakpoint
ALTER TABLE `booking_types` ADD `deposit_currency` varchar(3) DEFAULT 'PYG' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_types` ADD `allow_multi_service` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `party_size` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `deposit_confirmed_at` datetime;--> statement-breakpoint
ALTER TABLE `bookings` ADD `deposit_confirmed_by_user_id` char(26);--> statement-breakpoint
ALTER TABLE `bookings` ADD `services` json;--> statement-breakpoint
CREATE INDEX `booking_notifications_booking_idx` ON `booking_notifications` (`tenant_id`,`booking_id`);--> statement-breakpoint
CREATE INDEX `booking_notifications_message_idx` ON `booking_notifications` (`tenant_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `booking_type_services_type_idx` ON `booking_type_services` (`tenant_id`,`booking_type_id`,`sort`);