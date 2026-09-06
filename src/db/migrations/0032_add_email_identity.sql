CREATE TABLE `email_log` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`to` varchar(320) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`provider_id` varchar(100),
	`status` varchar(20) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `email_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenant_email_domains` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`resend_domain_id` varchar(100),
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`dns_records` json NOT NULL DEFAULT ('[]'),
	`verified_at` datetime,
	`from_local_part` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tenant_email_domains_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `email_log_tenant_id_idx` ON `email_log` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `email_log_tenant_created_idx` ON `email_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tenant_email_domains_tenant_id_idx` ON `tenant_email_domains` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `tenant_email_domains_status_idx` ON `tenant_email_domains` (`status`);